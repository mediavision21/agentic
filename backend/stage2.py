import os
import re
import llm
import evaldb
from db import execute_query
from data_examples import load_data_examples, load_kpi_combinations
from plot_config import generate_plot_and_summary

SKILLS_DIR = os.path.join(os.path.dirname(__file__), "..", "skills")


def _load_schema():
    path = os.path.join(SKILLS_DIR, "SKILL.md")
    if os.path.exists(path):
        with open(path) as f:
            return f.read()
    return ""


SYSTEM_PROMPT_TEMPLATE = """You are a data analyst assistant for MediaVision, a media intelligence platform with a PostgreSQL database of Nordic TV and streaming viewership data.

## Your behaviour
- If the user asks a question that requires data, generate SQL and a plot config.
- If the question is conversational, asks for clarification, or can be answered without data, reply in plain text (markdown supported). Do NOT generate SQL in that case.
- If the request is ambiguous, ask a clarifying question instead of guessing.
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

## Response format when generating SQL
Output in this exact order:

1. Primary SQL:
   ```sql
   <SELECT query>
   ```

2. If alternative approaches exist, add up to 2 more blocks labeled with a comment:
   ```sql
   -- Alternative 1
   <SELECT query>
   ```

3. One or two sentences explaining what the query does.

Do NOT generate a plot config — that will be handled separately.
"""


def build_system_prompt(data_examples="", kpi_combinations=""):
    base = SYSTEM_PROMPT_TEMPLATE.format(schema=_load_schema())
    if kpi_combinations:
        base += f"\n\n## Valid KPI combinations (CSV: category,kpi_type,kpi_dimension)\nOnly use combinations from this list:\n{kpi_combinations}"
    if data_examples:
        base += f"\n\n## Sample data (latest quarter, sweden + norway, key KPI types)\n{data_examples}"
    return base


def build_guided_system_prompt(matches, templates, data_examples="", kpi_combinations=""):
    schema = _load_schema()
    example_parts = []
    for m in matches:
        t = templates[m["file"]]
        desc = t.get("description", m["file"])
        sql = t.get("sql", "").strip()
        plots = t.get("plots", [])
        score_pct = int(m["score"] * 100)
        part = f"### {m['file']} (similarity: {score_pct}%)\nDescription: {desc}\n```sql\n{sql}\n```"
        if plots:
            part += f"\nPlot example:\n```js\n{plots[0].get('code','').strip()}\n```"
        example_parts.append(part)
    examples_section = "\n\n".join(example_parts)
    base = SYSTEM_PROMPT_TEMPLATE.format(schema=schema)
    if kpi_combinations:
        base += f"\n\n## Valid KPI combinations (CSV: category,kpi_type,kpi_dimension)\nOnly use combinations from this list:\n{kpi_combinations}"
    if data_examples:
        base += f"\n\n## Sample data (latest quarter, sweden + norway, key KPI types)\n{data_examples}"
    return base + f"\n\n## Similar templates for reference\nUse these as examples to guide your SQL and plot style:\n\n{examples_section}"


def extract_sql(text):
    match = re.search(r"```sql\s*(.*?)\s*```", text, re.DOTALL)
    if match:
        return match.group(1).strip()
    match = re.search(r"(SELECT\s+.+?;)", text, re.DOTALL | re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return None


def extract_sqls(text):
    # returns all sql blocks in order (primary first, then alternatives)
    return [m.strip() for m in re.findall(r"```sql\s*(.*?)\s*```", text, re.DOTALL)]



def _remove_empty_string_filters(sql):
    cols = ['age_group', 'population_segment', 'kpi_dimension']
    result = sql
    for col in cols:
        empty = r"""(?:'{2}|"{2})"""
        cond  = rf"""{col}\s*=\s*{empty}"""
        result = re.sub(rf'\n[ \t]*AND[ \t]+{cond}[ \t]*', '', result, flags=re.IGNORECASE)
        result = re.sub(rf'[ \t]*{cond}[ \t]+AND[ \t]*\n?', '', result, flags=re.IGNORECASE)
        result = re.sub(rf'[ \t]*{cond}[ \t]*', '', result, flags=re.IGNORECASE)
    result = re.sub(r'\bWHERE\s*(?=GROUP\b|ORDER\b|LIMIT\b)', '', result, flags=re.IGNORECASE)
    result = re.sub(r'\n[ \t]*\n', '\n', result)
    return result.strip()


def _fix_incomplete_is_null_or(sql):
    result = re.sub(
        r'\(\s*(\w+)\s+IS\s+NULL\s+OR\s*\)',
        r"(\1 IS NULL OR \1 = '')",
        sql,
        flags=re.IGNORECASE,
    )
    result = re.sub(
        r'\(\s*(\w+)\.(\w+)\s+IS\s+NULL\s+OR\s+\1\.\s*\)',
        r"(\1.\2 IS NULL OR \1.\2 = '')",
        result,
        flags=re.IGNORECASE,
    )
    return result


_POST_PROCESSORS = [
    ("remove_empty_string_filters", _remove_empty_string_filters),
    ("fix_incomplete_is_null_or", _fix_incomplete_is_null_or),
]


def postprocess_sql(sql):
    result = sql
    for name, fn in _POST_PROCESSORS:
        before = result
        result = fn(result)
        if result != before:
            print(f"[postprocess] {name} changed sql")
    return result



def build_messages(history, prompt):
    messages = []
    for h in history:
        messages.append({"role": h["role"], "content": h["text"]})
    messages.append({"role": "user", "content": prompt})
    return messages




async def run(options):
    prompt = options["prompt"]
    matches = options["matches"]
    templates = options["templates"]
    backend = options["backend"]
    history = options["history"]
    msg_id = options["msg_id"]
    user = options["user"]
    conversation_id = options["conversation_id"]

    # try 1: top 3 template matches, streaming
    try1_matches = matches[:3]
    print(f"[stage2] try1 guided generation with {[m['file'] for m in try1_matches]}")
    data_examples = await load_data_examples()
    kpi_combinations = await load_kpi_combinations()
    system_prompt = build_guided_system_prompt(try1_matches, templates, data_examples, kpi_combinations)
    messages = build_messages(history, prompt)

    full_text = ""
    async for chunk in llm.complete_stream(system_prompt, messages, {"backend": backend, "label": "stage2", "log_id": msg_id, "user": user, "conversation_id": conversation_id}):
        if isinstance(chunk, dict):
            break
        full_text += chunk
        print(chunk, end="", flush=True)
        yield {"type": "token", "text": chunk}
    print()

    sqls_raw = extract_sqls(full_text)

    if not sqls_raw:
        # no SQL generated — conversational response, not a data failure
        suggestions = []
        sugg_match = re.search(r"<!--suggestions\s*(.*?)\s*-->", full_text, re.DOTALL)
        if sugg_match:
            suggestions = [line.strip() for line in sugg_match.group(1).splitlines() if line.strip()]
        display_text = re.sub(r"\s*<!--suggestions.*?-->", "", full_text, flags=re.DOTALL).strip()
        yield {"type": "text", "text": display_text}
        if suggestions:
            yield {"type": "suggestions", "items": suggestions}
        return

    explanation = re.sub(r"```sql.*?```", "", full_text, flags=re.DOTALL).strip()

    # try each sql alternative until one returns rows
    data = None
    for i, sql_raw in enumerate(sqls_raw):
        sql = postprocess_sql(sql_raw)
        print(f"[stage2] try1 sql[{i}] executing")
        yield {"type": "sql", "sql": sql, "plot_config": None, "explanation": explanation}
        try:
            result = await execute_query(sql)
            if len(result["rows"]) > 0:
                print(f"[stage2] try1 sql[{i}] returned {len(result['rows'])} rows")
                data = result
                break
            else:
                print(f"[stage2] try1 sql[{i}] returned 0 rows")
        except Exception as e:
            print(f"[stage2] try1 sql[{i}] error: {e}")
            yield {"type": "error", "error": f"SQL error: {e}"}

    if data is not None:
        yield {"type": "rows", "columns": data["columns"], "rows": data["rows"]}
        plot_config = None
        summary = None
        try:
            plot_config, summary = await generate_plot_and_summary({"user_prompt": prompt, "columns": data["columns"], "rows": data["rows"], "backend": backend, "label": "stage2-plot", "log_id": msg_id, "user": user, "conversation_id": conversation_id})
            if plot_config:
                yield {"type": "plot_config", "plot_config": plot_config}
            if summary:
                yield {"type": "summary", "text": summary}
        except Exception as e:
            print(f"[stage2] plot+summary error: {e}")
        evaldb.update_result_data(msg_id, {"columns": data["columns"], "rows": data["rows"], "plot_config": plot_config, "summary": summary})
        return

    # try1 returned 0 rows for all alternatives — try2 with next 3 templates (non-streaming)
    if len(matches) > 3:
        try2_matches = matches[3:6]
        print(f"[stage2] try1 got 0 rows, try2 with {[m['file'] for m in try2_matches]}")
        try2_prompt = build_guided_system_prompt(try2_matches, templates, data_examples, kpi_combinations)
        try:
            retry_text = await llm.complete(try2_prompt, messages, {"backend": "claude", "label": "stage2-try2", "log_id": msg_id, "user": user, "conversation_id": conversation_id})
            retry_sqls_raw = extract_sqls(retry_text)
            retry_explanation = re.sub(r"```sql.*?```", "", retry_text, flags=re.DOTALL).strip()
            for i, retry_sql_raw in enumerate(retry_sqls_raw):
                retry_sql = postprocess_sql(retry_sql_raw)
                print(f"[stage2] try2 sql[{i}] executing")
                try:
                    retry_data = await execute_query(retry_sql)
                    if len(retry_data["rows"]) > 0:
                        print(f"[stage2] try2 sql[{i}] succeeded with {len(retry_data['rows'])} rows")
                        yield {"type": "sql", "sql": retry_sql, "plot_config": None, "explanation": retry_explanation}
                        yield {"type": "rows", "columns": retry_data["columns"], "rows": retry_data["rows"]}
                        retry_plot = None
                        retry_summary = None
                        try:
                            retry_plot, retry_summary = await generate_plot_and_summary({"user_prompt": prompt, "columns": retry_data["columns"], "rows": retry_data["rows"], "backend": backend, "label": "stage2-try2-plot", "log_id": msg_id, "user": user, "conversation_id": conversation_id})
                            if retry_plot:
                                yield {"type": "plot_config", "plot_config": retry_plot}
                            if retry_summary:
                                yield {"type": "summary", "text": retry_summary}
                        except Exception as e:
                            print(f"[stage2] try2 plot+summary error: {e}")
                        evaldb.update_result_data(msg_id, {"columns": retry_data["columns"], "rows": retry_data["rows"], "plot_config": retry_plot, "summary": retry_summary})
                        return
                    else:
                        print(f"[stage2] try2 sql[{i}] returned 0 rows")
                except Exception as e:
                    print(f"[stage2] try2 sql[{i}] error: {e}")
        except Exception as e:
            print(f"[stage2] try2 error: {e}")

    # all tries failed — signal stage3 to take over
    print(f"[stage2] no data from any try, handing off to stage3")
    yield {"type": "__stage2_no_data__"}
