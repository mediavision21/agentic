import os
import re
import json
import llm

_SKILL_DIR = os.path.join(os.path.dirname(__file__), "skill")


def _load_plot_skill():
    path = os.path.join(_SKILL_DIR, "plot.md")
    if os.path.exists(path):
        with open(path) as f:
            return f.read()
    return ""


_PROMPT_HEADER = """You are a data analyst. Given a user question and sample query result rows (CSV), return ONLY a ```json ... ``` block with this structure:
{
  "plot": {
    "marks": [
      {"type": "lineY|barY|dot|areaY", "x": "<col>", "y": "<col>", "stroke": "<col or null>", "fill": "<col or null>", "curve": "catmull-rom"}
    ],
    "x": {"label": "<text>"},
    "y": {"label": "<text>", "grid": true, "tickFormat": ".0% when ratio values 0-1"},
    "color": {"legend": true}
  },
  "summary": "<2-4 sentence summary of key trends, totals, or notable values>"
}
"""

_PROMPT_EXAMPLES = """
## Examples

Input columns: period_sort, period_label, year, quarter_label, country, reach_pct
Sample rows:
20111, Q1 2011, 2011, Q1, denmark, 2.67
20111, Q1 2011, 2011, Q1, finland, 5.33
20113, Q3 2011, 2011, Q3, denmark, 3.10
20113, Q3 2011, 2011, Q3, finland, 6.28

```json
{"plot":{"marks":[{"type":"lineY","x":"period_label","y":"reach_pct","stroke":"country","curve":"catmull-rom"}],"x":{"label":null},"y":{"label":"Reach %","grid":true},"color":{"legend":true}},"summary":"Reach varies by country over time. Finland consistently shows higher reach than Denmark across all measured quarters."}
```

Input columns: period_sort, period_label, country, viewing_time_minutes
Sample rows:
20221, Q1 2022, sweden, 31.2
20223, Q3 2022, sweden, 33.8
20231, Q1 2023, sweden, 34.5
20233, Q3 2023, sweden, 36.1

```json
{"plot":{"marks":[{"type":"lineY","x":"period_label","y":"viewing_time_minutes","curve":"catmull-rom"}],"x":{"label":null},"y":{"label":"Minutes per day","grid":true},"color":{"legend":false}},"summary":"Daily online video viewing time in Sweden has grown steadily, rising from 31.2 minutes in Q1 2022 to 36.1 minutes by Q3 2023."}
```

Respond with ONLY the ```json ... ``` block. No other text."""


def _build_system_prompt():
    plot_skill = _load_plot_skill()
    rules_section = f"\n## Plot rules\n\n{plot_skill}\n" if plot_skill else ""
    return _PROMPT_HEADER + rules_section + _PROMPT_EXAMPLES


async def generate_plot_and_summary(options):
    user_prompt = options["user_prompt"]
    columns = options["columns"]
    rows = options["rows"]
    backend = options.get("backend", "claude")
    label = options.get("label", "plot")
    log_id = options.get("log_id")
    user = options.get("user")
    conversation_id = options.get("conversation_id")

    sample = rows[:50]
    header = ", ".join(columns)
    lines = [header] + [", ".join(str(v) for v in row.values()) for row in sample]
    data_text = "\n".join(lines)
    user_msg = f"User question: {user_prompt}\n\nQuery result columns: {header}\nSample rows ({len(sample)}):\n{data_text}"
    system_prompt = _build_system_prompt()
    text = await llm.complete(system_prompt, [{"role": "user", "content": user_msg}], {"backend": backend, "label": label, "log_id": log_id, "user": user, "conversation_id": conversation_id})
    return extract_plot_and_summary(text)


async def generate_summary(prompt, columns, rows, backend):
    """Summary-only call used by template matches (no plot needed)."""
    _plot, summary = await generate_plot_and_summary({
        "user_prompt": prompt,
        "columns": columns,
        "rows": rows,
        "backend": backend,
        "label": "summary",
    })
    return summary


def extract_plot_and_summary(text):
    match = re.search(r"```json\s*(.*?)\s*```", text, re.DOTALL)
    if not match:
        return None, None
    try:
        obj = json.loads(match.group(1).strip())
        return obj.get("plot"), obj.get("summary")
    except Exception as e:
        print(f"[plot_config] parse error: {e}")
        return None, None
