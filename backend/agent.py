import os
import re
import json
import uuid
import yaml
from datetime import datetime
from skills import load_skills
from db import execute_query
import llm_claude
import llm_local
import evaldb
from template_router import load_templates, match_top_templates
from template_filters import detect_placeholders, load_filter_choices, apply_filters, FILTER_REGISTRY

LOGS_DIR = os.path.join(os.path.dirname(__file__), "..", "logs")


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


def build_system_prompt():
    skills = load_skills()
    schema_parts = []
    for name, content in skills["files"].items():
        schema_parts.append(content)
    return SYSTEM_PROMPT_TEMPLATE.format(schema="\n\n".join(schema_parts))


def build_guided_system_prompt(matches, templates):
    # Like build_system_prompt but includes top-3 templates as few-shot examples
    skills = load_skills()
    schema_parts = []
    for name, content in skills["files"].items():
        schema_parts.append(content)
    schema = "\n\n".join(schema_parts)

    example_parts = []
    for m in matches:
        t = templates[m["file"]]
        desc = t.get("description", m["file"])
        sql = t.get("sql", "").strip()
        plots = t.get("plots", [])
        score_pct = int(m["score"] * 100)
        part = f"### {m['file']} (similarity: {score_pct}%)\nDescription: {desc}\n```sql\n{sql}\n```"
        if plots:
            # include first plot code as reference
            part += f"\nPlot example:\n```js\n{plots[0].get('code','').strip()}\n```"
        example_parts.append(part)

    examples_section = "\n\n".join(example_parts)
    base = SYSTEM_PROMPT_TEMPLATE.format(schema=schema)
    return base + f"\n\n## Similar templates for reference\nUse these as examples to guide your SQL and plot style:\n\n{examples_section}"


def extract_sql(text):
    match = re.search(r"```sql\s*(.*?)\s*```", text, re.DOTALL)
    if match:
        return match.group(1).strip()
    match = re.search(r"(SELECT\s+.+?;)", text, re.DOTALL | re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return None


# --- SQL post-processors ---

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
    # fixes truncated patterns:
    #   (col IS NULL OR)         →  (col IS NULL OR col = '')
    #   (n.col IS NULL OR n.)    →  (n.col IS NULL OR n.col = '')
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


POST_PROCESSORS = [
    ("remove_empty_string_filters", _remove_empty_string_filters),
    ("fix_incomplete_is_null_or", _fix_incomplete_is_null_or),
]


def postprocess_sql(sql):
    result = sql
    for name, fn in POST_PROCESSORS:
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
        print(f"[agent] plot config parse error: {e}")
        return None


def build_llm_messages(history, prompt):
    # history: list of {"role": "user"|"assistant", "text": str}
    messages = []
    for h in history:
        messages.append({"role": h["role"], "content": h["text"]})
    messages.append({"role": "user", "content": prompt})
    return messages


FILTER_RESOLVE_PROMPT = """You are given a user message and a list of SQL template filter placeholders with their available choices.
Extract any filter values the user mentioned and return JSON only:
{"resolved": {"country_label": ["Denmark"], "year": ["2024"]}, "missing": ["quarter_label"]}
- "resolved": filters the user specified (use exact values from the choices list, case-insensitive match)
- "missing": filters the user did not mention
If the user did not specify ANY filter values at all, output exactly: NONE
Output nothing except the JSON or NONE."""


async def resolve_template_filters(prompt, placeholders, choices_map):
    # Returns (resolved_dict, missing_list) or None if user specified nothing
    lines = [f"User message: {prompt}", "", "Filter placeholders:"]
    for name in placeholders:
        choices = choices_map.get(name, [])
        spec = FILTER_REGISTRY.get(name, {})
        label = spec.get("label", name)
        lines.append(f"- {name} ({label}): {', '.join(str(c) for c in choices)}")
    user_msg = "\n".join(lines)
    try:
        resp = await llm_claude.complete_fast(FILTER_RESOLVE_PROMPT, [{"role": "user", "content": user_msg}])
        text = resp.content[0].text.strip()
        print(f"[agent] filter resolve response: {text}")
        if text == "NONE":
            return None
        data = __import__("json").loads(text)
        return data.get("resolved", {}), data.get("missing", [])
    except Exception as e:
        print(f"[agent] filter resolve error: {e}")
        return None


async def generate_agent_stream(prompt, backend="claude", history=None, user="", conversation_id=""):
    if history is None:
        history = []

    msg_id = str(uuid.uuid4())
    yield {"type": "msg_id", "id": msg_id}

    # template routing — rank top 3 templates by similarity
    templates = load_templates()
    matches = await match_top_templates(prompt, templates) if templates else []

    if matches and matches[0]["score"] >= 0.95:
        # full match — use template directly
        matched_file = matches[0]["file"]
        template = templates[matched_file]
        sql = template["sql"].strip()
        description = template.get("description", matched_file)
        print(f"[agent] template full match: {matched_file} score={matches[0]['score']}")

        # resolve [[ AND {{placeholder}} ]] filters if present
        placeholders = detect_placeholders(sql)
        if placeholders:
            print(f"[agent] template has placeholders: {placeholders}")
            choices_map = await load_filter_choices(placeholders)
            result = await resolve_template_filters(prompt, placeholders, choices_map)
            if result is None:
                # user didn't specify — ask for choices
                lines = ["To show this chart, please specify the filters:"]
                suggestions = []
                for name in placeholders:
                    spec = FILTER_REGISTRY.get(name, {})
                    label = spec.get("label", name)
                    choices = choices_map.get(name, [])
                    lines.append(f"- **{label}**: {', '.join(str(c) for c in choices)}")
                    suggestions.extend([str(c) for c in choices[:4]])
                yield {"type": "text", "text": "\n".join(lines)}
                yield {"type": "suggestions", "items": suggestions}
                return
            resolved, _missing = result
            sql = apply_filters(sql, resolved)
            print(f"[agent] filters applied: {resolved}")

        yield {"type": "sql", "sql": sql, "plot_config": None, "explanation": description}

        try:
            data = await execute_query(sql)
            yield {"type": "rows", "columns": data["columns"], "rows": data["rows"]}
        except Exception as e:
            print(f"[agent] template query error: {e}")
            yield {"type": "error", "error": f"SQL error: {e}"}
            evaldb.save_log(
                msg_id, prompt, f"[template] {matched_file}", [], sql,
                "template", {}, user=user, conversation_id=conversation_id
            )
            return

        if template.get("plots"):
            yield {"type": "template_plots", "plots": template["plots"]}

        try:
            summary = await generate_summary(prompt, data["columns"], data["rows"], backend)
            yield {"type": "summary", "text": summary}
        except Exception as e:
            print(f"[agent] summary error: {e}")

        evaldb.save_log(
            msg_id, prompt, f"[template] {matched_file}", [], sql,
            "template", {}, user=user, conversation_id=conversation_id,
            result_data={"columns": data["columns"], "rows": data["rows"], "plot_config": None}
        )
        return

    # partial match or no match — generate SQL with guided or full skill prompt
    if matches:
        print(f"[agent] guided generation with {len(matches)} template hints")
        system_prompt = build_guided_system_prompt(matches, templates)
    else:
        print(f"[agent] no template match, using full skill prompt")
        system_prompt = build_system_prompt()
    messages = build_llm_messages(history, prompt)

    os.makedirs(LOGS_DIR, exist_ok=True)
    ts = datetime.now().strftime("%Y-%m-%d_%H:%M:%S")
    with open(os.path.join(LOGS_DIR, f"{ts}-request.md"), "w") as f:
        f.write(f"backend: {backend}\nprompt: {prompt}\n\nsystem:\n{system_prompt}\n")

    full_text = ""
    meta = {}
    stream_fn = llm_local.complete_stream if backend == "local" else llm_claude.complete_stream
    async for chunk in stream_fn(system_prompt, messages):
        if isinstance(chunk, dict):
            meta = chunk.get("__meta__", {})
            break
        full_text += chunk
        print(chunk, end="", flush=True)
        yield {"type": "token", "text": chunk}
    print()

    ts = datetime.now().strftime("%Y-%m-%d_%H:%M:%S")
    with open(os.path.join(LOGS_DIR, f"{ts}-response.md"), "w") as f:
        f.write(full_text)
    with open(os.path.join(LOGS_DIR, f"{ts}-response.yaml"), "w") as f:
        yaml.dump({
            "backend": backend,
            "prompt": prompt,
            "model": meta.get("model", ""),
            "usage": meta.get("usage", {}),
            "response": full_text,
        }, f, default_flow_style=False, allow_unicode=True)

    result_data = {}
    sql_raw = extract_sql(full_text)

    if sql_raw is None:
        # parse and strip suggestions block
        suggestions = []
        sugg_match = re.search(r"<!--suggestions\s*(.*?)\s*-->", full_text, re.DOTALL)
        if sugg_match:
            suggestions = [line.strip() for line in sugg_match.group(1).splitlines() if line.strip()]
        display_text = re.sub(r"\s*<!--suggestions.*?-->", "", full_text, flags=re.DOTALL).strip()
        yield {"type": "text", "text": display_text}
        if suggestions:
            yield {"type": "suggestions", "items": suggestions}
        evaldb.save_log(
            msg_id, prompt, system_prompt, messages, full_text,
            meta.get("model", ""), meta.get("usage", {}),
            user=user, conversation_id=conversation_id
        )
        return

    sql = postprocess_sql(sql_raw)
    plot_config = extract_plot_config(full_text)
    explanation = re.sub(r"```(?:sql|json).*?```", "", full_text, flags=re.DOTALL).strip()

    with open(os.path.join(LOGS_DIR, f"{ts}-sql.md"), "w") as f:
        f.write(f"## raw\n```sql\n{sql_raw}\n```\n\n## post-processed\n```sql\n{sql}\n```\n")

    yield {"type": "sql", "sql": sql, "plot_config": plot_config, "explanation": explanation}

    try:
        data = await execute_query(sql)
        yield {"type": "rows", "columns": data["columns"], "rows": data["rows"]}
        result_data = {"columns": data["columns"], "rows": data["rows"], "plot_config": plot_config}
    except Exception as e:
        print(f"[agent] query error: {e}")
        yield {"type": "error", "error": f"SQL error: {e}"}
        evaldb.save_log(
            msg_id, prompt, system_prompt, messages, full_text,
            meta.get("model", ""), meta.get("usage", {}),
            user=user, conversation_id=conversation_id
        )
        return

    # retry with next 3 templates if no rows returned and we have more candidates
    if len(data["rows"]) == 0 and matches and len(matches) > 3:
        print(f"[agent] 0 rows, retrying with templates {[m['file'] for m in matches[3:6]]}")
        retry_system_prompt = build_guided_system_prompt(matches[3:6], templates)
        try:
            retry_resp = await llm_claude.complete(retry_system_prompt, messages)
            retry_text = retry_resp.content[0].text.strip()
            retry_sql_raw = extract_sql(retry_text)
            if retry_sql_raw:
                retry_sql = postprocess_sql(retry_sql_raw)
                retry_plot = extract_plot_config(retry_text)
                retry_explanation = re.sub(r"```(?:sql|json).*?```", "", retry_text, flags=re.DOTALL).strip()
                retry_data = await execute_query(retry_sql)
                if len(retry_data["rows"]) > 0:
                    print(f"[agent] retry succeeded with {len(retry_data['rows'])} rows")
                    yield {"type": "sql", "sql": retry_sql, "plot_config": retry_plot, "explanation": retry_explanation}
                    yield {"type": "rows", "columns": retry_data["columns"], "rows": retry_data["rows"]}
                    data = retry_data
                    result_data = {"columns": retry_data["columns"], "rows": retry_data["rows"], "plot_config": retry_plot}
                else:
                    print(f"[agent] retry also returned 0 rows, stopping")
                    return
            else:
                print(f"[agent] retry produced no SQL, stopping")
                return
        except Exception as e:
            print(f"[agent] retry error: {e}")
            return

    try:
        summary = await generate_summary(prompt, data["columns"], data["rows"], backend)
        yield {"type": "summary", "text": summary}
        result_data["summary"] = summary
    except Exception as e:
        print(f"[agent] summary error: {e}")

    evaldb.save_log(
        msg_id, prompt, system_prompt, messages, full_text,
        meta.get("model", ""), meta.get("usage", {}),
        user=user, conversation_id=conversation_id, result_data=result_data
    )


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
