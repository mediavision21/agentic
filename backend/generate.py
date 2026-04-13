import json
import re
import llm
import evaldb
from db import execute_query, fetch_schema_text
from data_examples import load_data_examples, load_kpi_combinations
from plot_config import generate_plot_and_summary
from sql_utils import postprocess_sql, build_messages


SYSTEM_PROMPT_TEMPLATE = """You are a data analyst assistant for MediaVision, a media intelligence platform with a PostgreSQL database of Nordic TV and streaming viewership data.

## Your behaviour
- If the user asks a question that requires data, call the `query` tool to run SQL. You may call it multiple times in one turn — use it to explore (distinct values, row counts, column ranges) when a filter might not match, before issuing the final query.
- If the question is conversational, asks for clarification, or can be answered without data, reply in plain text (markdown supported). Do NOT call the tool in that case.
- If a "Resolved Query Intent" block is provided below, use those values exactly for your SQL. Never ask a clarifying question when intent has been resolved.
- If a `query` call returns 0 rows, DO NOT give up. Call the tool again — first to inspect the data (e.g. `SELECT DISTINCT country FROM macro.nordic WHERE kpi_type = '...'`) and then with a corrected query. Only fall back to plain text after you have investigated.
- When offering the user a list of options to choose from, append this exact block at the very end of your response (after all other text):

<!--suggestions
Option text 1
Option text 2
-->

Each line inside the block becomes a clickable button the user can tap instead of typing.

## Database Schema
{schema}

## SQL rules
- Generate ONLY SELECT queries. Never INSERT, UPDATE, DELETE, DROP.
- Use column names and types from the schema exactly.
- PostgreSQL (Supabase) restrictions — strictly follow:
  - Never nest aggregate functions (e.g. `SUM(AVG(...))` is illegal). Use a subquery or CTE to compute the inner aggregate first.
  - Never use a window function directly inside an aggregate, or vice versa. Stage them in separate CTEs.
  - Never reference a column alias defined in the same SELECT in a WHERE or HAVING clause — repeat the expression or use a subquery.
  - Use `FILTER (WHERE ...)` instead of `CASE WHEN ... END` inside aggregates where possible.
  - Prefer CTEs (`WITH ...`) over deeply nested subqueries to keep aggregation stages flat and readable.
  - Never join `macro.population`, `fact_population`, or any external population table — use the `population` and `population_household` columns already present on every `macro.nordic` row.
  - `ROUND(x, n)` requires `x` to be `numeric`. Cast the entire expression: `ROUND((expr)::numeric, 1)`. Do NOT cast only part of it (e.g. `ROUND(a / NULLIF(b,0)::numeric, 1)` is wrong — the cast only applies to `NULLIF`, leaving the division as `double precision`).
  - When self-joining a table (e.g. `macro.nordic vt JOIN macro.nordic r`), every column in SELECT, GROUP BY, and ORDER BY must be prefixed with a table alias. Unqualified column names like `period_date` are ambiguous and will error — write `vt.period_date` instead.

## For tables with kpi_type
Before writing SQL, think step by step:
1. Which kpi_type does this question map to? (pick exactly one from the valid values)
2. Which kpi_dimension narrows the market segment?
3. Does the question ask about a specific service? If yes, use a _service kpi_type.
4. Is a genre breakdown needed? Filter kpi_dimension='genre' and set kpi_detail.

SQL MUST always include:
  WHERE kpi_type = '<single value>' AND kpi_dimension = '<single value>'

NEVER aggregate across multiple kpi_type values.
NEVER use OR on kpi_type. NEVER omit the kpi_type filter.

## Template filters
Some templates have optional filter placeholders in `[[ AND {{name}} ]]` syntax.
When a user's request doesn't specify filter values, ask which values to use
and include a <!--suggestions --> block with the most useful options.

## Tool usage
- The `query` tool runs a single SELECT against `macro.nordic` and returns `{{"columns": [...], "row_count": N, "rows": [...]}}`. Rows are truncated to 20 in the tool result but the full set is shown to the user.
- Prefer one answer query. If the first attempt returns 0 rows, make at most 1–2 exploratory calls before a corrected answer query.
- After you have data, respond in 1–2 plain-text sentences describing what the data shows. Do NOT paste the SQL back into the text reply — the SQL is already visible to the user via the tool call.
"""


async def build_system_prompt(matches=None, templates=None, data_examples="", kpi_combinations="", intent_block="", prior_sql=None):
    schema = await fetch_schema_text()
    base = SYSTEM_PROMPT_TEMPLATE.format(schema=schema)
    if kpi_combinations:
        base += f"\n\n## Valid KPI combinations (CSV: category,kpi_type,kpi_dimension)\nOnly use combinations from this list:\n{kpi_combinations}"
    if data_examples:
        base += f"\n\n## Sample data (latest quarter, sweden + norway, key KPI types)\n{data_examples}"
    if intent_block:
        base += f"\n\n{intent_block}"
    if prior_sql:
        base += (
            "\n\n## Prior Turn Context (this is a follow-up — modify, do not replace)"
            "\nThe user is asking to modify the previous result. Adjust the SQL to incorporate their request "
            "while preserving the prior query's structure (e.g., add a period, filter, or column). "
            "Keep the same kpi_type, services, countries, and grouping unless the user explicitly asks to change them."
            f"\n\nPrior SQL:\n```sql\n{prior_sql}\n```"
        )
    if matches and templates:
        example_parts = []
        for m in matches[:3]:
            t = templates[m["file"]]
            desc = t.get("description", m["file"])
            sql = t.get("sql", "").strip()
            score_pct = int(m["score"] * 100)
            example_parts.append(f"### {m['file']} (similarity: {score_pct}%)\nDescription: {desc}\n```sql\n{sql}\n```")
        examples_section = "\n\n".join(example_parts)
        base += f"\n\n## Similar templates for reference\nUse these as examples to guide your SQL style:\n\n{examples_section}"
    return base


def _format_tool_result(columns, rows):
    if not rows:
        return json.dumps({"columns": columns, "row_count": 0, "rows": []})
    sample = rows[:20]
    return json.dumps({
        "columns": columns,
        "row_count": len(rows),
        "rows": sample,
        "truncated": len(rows) > 20,
    }, default=str)


async def run(options):
    prompt = options["prompt"]
    matches = options.get("matches") or []
    templates = options.get("templates") or {}
    backend = options["backend"]
    history = options["history"]
    msg_id = options["msg_id"]
    user = options["user"]
    conversation_id = options["conversation_id"]
    intent_block = options.get("intent_block", "")
    prior_sql = options.get("prior_sql")
    prior_plot_config = options.get("prior_plot_config")

    data_examples = await load_data_examples()
    kpi_combinations = await load_kpi_combinations()
    system_prompt = await build_system_prompt(matches, templates, data_examples, kpi_combinations, intent_block, prior_sql)
    messages = build_messages(history, prompt)
    print(f"[generate] running with {len(matches)} template hints")

    last_success = {"sql": None, "columns": None, "rows": None}

    async def tool_handler(name, input):
        if name != "query":
            return {"content": json.dumps({"error": f"unknown tool {name}"}), "events": [], "rows": 0}
        raw_sql = input.get("sql", "") or ""
        sql = postprocess_sql(raw_sql)
        print(f"[generate] query tool → {sql[:200]}")
        try:
            result = await execute_query(sql)
        except Exception as e:
            print(f"[generate] query error: {e}")
            return {
                "content": json.dumps({"error": f"SQL error: {e}"}),
                "events": [{"type": "error", "error": f"SQL error: {e}"}],
                "rows": 0,
            }
        columns = result["columns"]
        rows = result["rows"]
        if rows:
            last_success["sql"] = sql
            last_success["columns"] = columns
            last_success["rows"] = rows
        return {"content": _format_tool_result(columns, rows), "events": [], "rows": len(rows)}

    tools = [{
        "name": "query",
        "description": "Run a read-only SELECT against macro.nordic. Use it for the final answer and for exploration (e.g. `SELECT DISTINCT country FROM macro.nordic WHERE kpi_type='reach' LIMIT 50`). If a call returns 0 rows, call again with a corrected query after investigating — never give up after one attempt.",
        "input_schema": {
            "type": "object",
            "properties": {"sql": {"type": "string", "description": "A read-only SELECT statement against macro.nordic."}},
            "required": ["sql"],
        },
    }]

    yield {"type": "round", "label": "SQL"}
    full_text = ""
    async for chunk in llm.complete_with_tools_stream(system_prompt, messages, tools, tool_handler, {"backend": backend, "label": "generate", "log_id": msg_id, "user": user, "conversation_id": conversation_id, "max_iterations": 5}):
        if isinstance(chunk, dict):
            if chunk.get("type"):
                yield chunk
            continue
        full_text += chunk
        print(chunk, end="", flush=True)
        yield {"type": "token", "text": chunk}
    print()

    if last_success["rows"] is None:
        # no rows from any tool call — treat model's final text as conversational answer
        suggestions = []
        sugg_match = re.search(r"<!--suggestions\s*(.*?)\s*-->", full_text, re.DOTALL)
        if sugg_match:
            suggestions = [line.strip() for line in sugg_match.group(1).splitlines() if line.strip()]
        display_text = re.sub(r"\s*<!--suggestions.*?-->", "", full_text, flags=re.DOTALL).strip()
        if display_text:
            yield {"type": "text", "text": display_text}
        if suggestions:
            yield {"type": "suggestions", "items": suggestions}
        return

    explanation = re.sub(r"```sql.*?```", "", full_text, flags=re.DOTALL).strip()
    yield {"type": "sql", "sql": last_success["sql"], "plot_config": None, "explanation": explanation}
    yield {"type": "rows", "columns": last_success["columns"], "rows": last_success["rows"]}

    yield {"type": "round", "label": "Plot & Summary"}
    plot_config = None
    summary = None
    try:
        plot_config, summary, plot_debug = await generate_plot_and_summary({"user_prompt": prompt, "columns": last_success["columns"], "rows": last_success["rows"], "backend": backend, "label": "generate-plot", "log_id": msg_id, "user": user, "conversation_id": conversation_id, "prior_plot_config": prior_plot_config})
        yield {"type": "prompt", "text": plot_debug["prompt"]}
        yield {"type": "messages", "messages": plot_debug["messages"]}
        yield {"type": "response", "text": plot_debug["response"]}
        if plot_config:
            yield {"type": "plot_config", "plot_config": plot_config}
        if summary:
            yield {"type": "summary", "text": summary}
    except Exception as e:
        print(f"[generate] plot+summary error: {e}")

    evaldb.update_result_data(msg_id, {"columns": last_success["columns"], "rows": last_success["rows"], "plot_config": plot_config, "summary": summary})
