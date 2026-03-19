import os
import re
import json
import yaml
from datetime import datetime
from skills import load_skills
from db import execute_query
import llm_claude
import llm_local

LOGS_DIR = os.path.join(os.path.dirname(__file__), "..", "logs")


SYSTEM_PROMPT_TEMPLATE = """You are a SQL expert assistant. You generate PostgreSQL queries based on the user's natural language request.

## Database Schema
{schema}

## Rules
- Generate ONLY SELECT queries. Never generate INSERT, UPDATE, DELETE, DROP, or any mutating SQL.
- Use the column names and types from the schema exactly.
- If the user's request is ambiguous, make a reasonable assumption and note it in the explanation.

## For tables with kpi_type
Before writing any SQL, think step by step:
1. Which kpi_type does this question map to? (pick exactly one from the valid values)
2. Which kpi_dimension narrows the market segment? (pick one, or '' for total)
3. Does the question ask about a specific service? If yes, use a _service kpi_type.
4. Is a genre breakdown needed? If yes, filter kpi_dimension='genre' and set kpi_detail.

Then write SQL that ALWAYS includes:
  WHERE kpi_type = '<single value>' AND kpi_dimension = '<single value>'

NEVER select or aggregate across multiple kpi_type values — value column units differ per kpi_type and mixing them produces meaningless numbers.
NEVER use OR on kpi_type. NEVER omit the kpi_type filter.

## Response format
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

Rules for choosing mark type and options:
- Time series (x = period_key, year, quarter) → lineY
- Categorical comparison (x = country, service_id, category) → barY
- Scatter / two numeric axes → dot
- Multiple series (multiple countries, services, dimensions) → set stroke to the grouping column
- Include "color": {{"legend": true}} only when stroke is set to a column name
- Omit "color" key when stroke is null or a literal color string
"""


def build_prompt():
    skills = load_skills()
    schema_parts = []
    for name, content in skills["files"].items():
        schema_parts.append(content)
    return SYSTEM_PROMPT_TEMPLATE.format(schema="\n\n".join(schema_parts))


def extract_sql(text):
    match = re.search(r"```sql\s*(.*?)\s*```", text, re.DOTALL)
    if match:
        return match.group(1).strip()
    match = re.search(r"(SELECT\s+.+?;)", text, re.DOTALL | re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return text.strip()


def extract_plot_config(text):
    match = re.search(r"```json\s*(.*?)\s*```", text, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group(1).strip())
    except Exception as e:
        print(f"[agent] plot config parse error: {e}")
        return None


async def generate_sql_stream(user_prompt, backend="claude"):
    # async generator yielding SSE event dicts
    system_prompt = build_prompt()

    os.makedirs(LOGS_DIR, exist_ok=True)
    ts = datetime.now().strftime("%Y-%m-%d_%H:%M:%S")
    with open(os.path.join(LOGS_DIR, f"{ts}-request.md"), "w") as f:
        f.write(f"backend: {backend}\nprompt: {user_prompt}\n\nsystem:\n{system_prompt}\n")

    full_text = ""
    meta = {}
    stream_fn = llm_local.complete_stream if backend == "local" else llm_claude.complete_stream
    async for chunk in stream_fn(system_prompt, user_prompt):
        if isinstance(chunk, dict):
            meta = chunk.get("__meta__", {})
            break
        full_text += chunk
        print(chunk, end="", flush=True)
        yield {"type": "token", "text": chunk}
    print()  # newline after stream ends

    ts = datetime.now().strftime("%Y-%m-%d_%H:%M:%S")
    with open(os.path.join(LOGS_DIR, f"{ts}-response.md"), "w") as f:
        f.write(full_text)
    with open(os.path.join(LOGS_DIR, f"{ts}-response.yaml"), "w") as f:
        yaml.dump({
            "backend": backend,
            "prompt": user_prompt,
            "model": meta.get("model", ""),
            "usage": meta.get("usage", {}),
            "response": full_text,
        }, f, default_flow_style=False, allow_unicode=True)

    sql = extract_sql(full_text)
    plot_config = extract_plot_config(full_text)
    explanation = re.sub(r"```(?:sql|json).*?```", "", full_text, flags=re.DOTALL).strip()
    yield {"type": "sql", "sql": sql, "plot_config": plot_config, "explanation": explanation}

    try:
        data = await execute_query(sql)
        yield {"type": "rows", "columns": data["columns"], "rows": data["rows"]}
    except Exception as e:
        print(f"[agent] query error: {e}")
        yield {"type": "error", "error": f"SQL error: {e}"}
        return

    try:
        summary = await generate_summary(user_prompt, data["columns"], data["rows"], backend)
        yield {"type": "summary", "text": summary}
    except Exception as e:
        print(f"[agent] summary error: {e}")


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
        raw = await llm_claude.complete(SUMMARY_SYSTEM_PROMPT, user_msg)
        return raw.content[0].text.strip()
