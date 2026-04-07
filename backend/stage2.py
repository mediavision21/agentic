import os
import re
import json
import llm_claude
import llm_local
import evaldb
from db import execute_query

SKILLS_DIR = os.path.join(os.path.dirname(__file__), "..", "skills")

_data_examples_cache = None

DATA_EXAMPLES_SQL = """
WITH latest AS (
    SELECT year, quarter
    FROM macro.nordic
    ORDER BY year DESC, quarter DESC
    LIMIT 1
),
ranked AS (
    SELECT
        n.year,
        n.quarter_label,
        n.country,
        n.category,
        COALESCE(n.canonical_name, '') AS service,
        n.kpi_type,
        COALESCE(n.kpi_dimension, '') AS kpi_dimension,
        COALESCE(n.kpi_detail, '') AS kpi_detail,
        n.age_group,
        COALESCE(n.population_segment, '') AS population_segment,
        ROUND(n.value::numeric, 4) AS value,
        ROW_NUMBER() OVER (
            PARTITION BY n.kpi_type, n.country
            ORDER BY n.category, n.canonical_name, n.kpi_dimension
        ) AS rn
    FROM macro.nordic n
    JOIN latest l ON n.year = l.year AND n.quarter = l.quarter
    WHERE n.country IN ('sweden', 'norway')
      AND n.kpi_type IN ('reach', 'viewing_time', 'penetration', 'spend', 'reach_service')
)
SELECT year, quarter_label, country, category, service,
       kpi_type, kpi_dimension, kpi_detail, age_group, population_segment, value
FROM ranked
WHERE rn <= 5
ORDER BY kpi_type, country, rn
"""


async def load_data_examples():
    global _data_examples_cache
    if _data_examples_cache is not None:
        return _data_examples_cache
    try:
        data = await execute_query(DATA_EXAMPLES_SQL)
        cols = data["columns"]
        lines = [",".join(str(c) for c in cols)]
        for row in data["rows"]:
            lines.append(",".join("" if row[c] is None else str(row[c]) for c in cols))
        _data_examples_cache = "\n".join(lines)
    except Exception as e:
        print(f"[stage2] load_data_examples error: {e}")
        _data_examples_cache = ""
    return _data_examples_cache


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

1. ```sql
   <SELECT query>
   ```

2. ```json
   <Observable Plot config — see spec below>
   ```

3. One or two sentences explaining what the query does.

## Observable Plot config spec
{{
  "marks": [
    {{"type": "lineY|barY|dot|areaY", "x": "<col>", "y": "<col>", "stroke": "<col or null>", "fill": "<col or null>"}}
  ],
  "x": {{"label": "<text>"}},
  "y": {{"label": "<text>", "grid": true}},
  "color": {{"legend": true}}
}}

Rules for mark type:
- Time series (x = period_date, year, quarter) → lineY
- Categorical comparison (x = country, service_id, category) → barY
- Scatter / two numeric axes → dot
- Single country, no age breakdown → no stroke
- Multiple countries, no age breakdown → stroke = "country"
- Multiple age groups, single country → stroke = "age_group"
- Multiple countries AND age groups → SQL must produce a `series` column (country || ' · ' || age_group), stroke = "series"
- Any categorical column in SELECT (category, kpi_dimension, service, age_group) → MUST be stroke/fill, never omit it
- Include "color": {{"legend": true}} whenever stroke is set to a column name
"""


def build_system_prompt(data_examples=""):
    base = SYSTEM_PROMPT_TEMPLATE.format(schema=_load_schema())
    if data_examples:
        base += f"\n\n## Sample data (latest quarter, sweden + norway, key KPI types)\n{data_examples}"
    return base


def build_guided_system_prompt(matches, templates, data_examples=""):
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


def extract_plot_config(text):
    match = re.search(r"```json\s*(.*?)\s*```", text, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group(1).strip())
    except Exception as e:
        print(f"[stage2] plot config parse error: {e}")
        return None


def build_messages(history, prompt):
    messages = []
    for h in history:
        messages.append({"role": h["role"], "content": h["text"]})
    messages.append({"role": "user", "content": prompt})
    return messages


SUMMARY_SYSTEM_PROMPT = """You are a data analyst. The user asked a question and a SQL query was run. Given the result rows, write a concise summary (2-4 sentences) of what the data shows. Focus on key trends, totals, or notable values. Do not repeat the SQL."""


async def generate_summary(user_prompt, columns, rows, backend="claude"):
    sample = rows[:100]
    header = ", ".join(columns)
    lines = [header] + [", ".join(str(v) for v in row.values()) for row in sample]
    data_text = "\n".join(lines)
    user_msg = f"User question: {user_prompt}\n\nQuery result ({len(sample)} rows):\n{data_text}"
    if backend == "local":
        raw = await llm_local.complete(SUMMARY_SYSTEM_PROMPT, user_msg)
        return raw["choices"][0]["message"]["content"].strip()
    else:
        raw = await llm_claude.complete(SUMMARY_SYSTEM_PROMPT, [{"role": "user", "content": user_msg}])
        return raw.content[0].text.strip()


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
    system_prompt = build_guided_system_prompt(try1_matches, templates, data_examples)
    messages = build_messages(history, prompt)

    full_text = ""
    stream_fn = llm_local.complete_stream if backend == "local" else llm_claude.complete_stream
    async for chunk in stream_fn(system_prompt, messages, label="stage2", log_id=msg_id, user=user, conversation_id=conversation_id):
        if isinstance(chunk, dict):
            break
        full_text += chunk
        print(chunk, end="", flush=True)
        yield {"type": "token", "text": chunk}
    print()

    sql_raw = extract_sql(full_text)

    if sql_raw is None:
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

    sql = postprocess_sql(sql_raw)
    plot_config = extract_plot_config(full_text)
    explanation = re.sub(r"```(?:sql|json).*?```", "", full_text, flags=re.DOTALL).strip()

    yield {"type": "sql", "sql": sql, "plot_config": plot_config, "explanation": explanation}

    result_data = {}
    try:
        data = await execute_query(sql)
        yield {"type": "rows", "columns": data["columns"], "rows": data["rows"]}
        result_data = {"columns": data["columns"], "rows": data["rows"], "plot_config": plot_config}
    except Exception as e:
        print(f"[stage2] try1 query error: {e}")
        yield {"type": "error", "error": f"SQL error: {e}"}
        return

    if len(data["rows"]) > 0:
        # try1 returned data — done
        try:
            summary = await generate_summary(prompt, data["columns"], data["rows"], backend)
            yield {"type": "summary", "text": summary}
            result_data["summary"] = summary
        except Exception as e:
            print(f"[stage2] summary error: {e}")
        evaldb.update_result_data(msg_id, result_data)
        return

    # try1 returned 0 rows — try2 with next 3 templates (non-streaming)
    if len(matches) > 3:
        try2_matches = matches[3:6]
        print(f"[stage2] try1 got 0 rows, try2 with {[m['file'] for m in try2_matches]}")
        try2_prompt = build_guided_system_prompt(try2_matches, templates, data_examples)
        try:
            retry_resp = await llm_claude.complete(try2_prompt, messages, label="stage2-try2", log_id=msg_id, user=user, conversation_id=conversation_id)
            retry_text = retry_resp.content[0].text.strip()
            retry_sql_raw = extract_sql(retry_text)
            if retry_sql_raw:
                retry_sql = postprocess_sql(retry_sql_raw)
                retry_plot = extract_plot_config(retry_text)
                retry_explanation = re.sub(r"```(?:sql|json).*?```", "", retry_text, flags=re.DOTALL).strip()
                retry_data = await execute_query(retry_sql)
                if len(retry_data["rows"]) > 0:
                    print(f"[stage2] try2 succeeded with {len(retry_data['rows'])} rows")
                    yield {"type": "sql", "sql": retry_sql, "plot_config": retry_plot, "explanation": retry_explanation}
                    yield {"type": "rows", "columns": retry_data["columns"], "rows": retry_data["rows"]}
                    result_data = {"columns": retry_data["columns"], "rows": retry_data["rows"], "plot_config": retry_plot}
                    try:
                        summary = await generate_summary(prompt, retry_data["columns"], retry_data["rows"], backend)
                        yield {"type": "summary", "text": summary}
                        result_data["summary"] = summary
                    except Exception as e:
                        print(f"[stage2] try2 summary error: {e}")
                    evaldb.update_result_data(msg_id, result_data)
                    return
                else:
                    print(f"[stage2] try2 also got 0 rows")
        except Exception as e:
            print(f"[stage2] try2 error: {e}")

    # both tries failed — signal stage3 to take over
    print(f"[stage2] no data from either try, handing off to stage3")
    yield {"type": "__stage2_no_data__"}
