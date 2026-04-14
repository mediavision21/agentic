import re
import json
import llm


_PROMPT_HEADER = """You are a data analyst. Given a user question and sample query result rows (CSV in long/tidy form), return ONLY a ```json ... ``` block with this structure:
{
  "plot": {
	"marks": [
	  {"type": "lineY|barY|dot|areaY", "x": "<col>", "y": "<col>", "stroke": "<col or null>", "fill": "<col or null>", "curve": "catmull-rom"}
	],
	"x": {"label": "<text>"},
	"y": {"label": "<text>", "grid": true, "tickFormat": ".0% when ratio values 0-1"},
	"color": {"legend": true}
  },
  "summary": "<2-4 sentence summary — always state the time period covered; if there is a trend describe direction and magnitude; if there is a comparison highlight the top/bottom and the gap>"
}

Data is always in long/tidy form: one row per observation, a single `value` column, with categorical keys (service, country, period_label, …) as separate columns. Map those keys to `stroke`, `fill`, or `fx` facets — not to separate y columns.

- line mark with spline if prefered option
- only use bar plot when there is clear comparsion side by side for at most 3 categories.
- only add area mark when use clear requested
- categorical stroke/fill/fx columns: if more than 8 unique values exist, include only the top 8 by total value in the config (add a note in summary)
- for comparison charts (fx facets or top-growth), limit to top 8 categories by value
- in the summary text, avoid using the words "reach" or "penetration" as generic explanatory words (e.g. "reaching X" or "penetrating the market") — these are metric names in the data and would be confusing; use alternatives like "grew to", "rose to", "climbed", "expanded", "achieved" instead
- for the y-axis label: if the data contains columns kpi_type, kpi_dimension, or kpi_service, use their distinct value(s) as the label (e.g. "reach", "svod penetration", "linear reach") — prefer kpi_dimension over kpi_type when both present
"""

_PROMPT_EXAMPLES = """
## Examples

Input columns: period_sort, period_label, country, value
Sample rows:
20111, Q1 2011, denmark, 2.67
20111, Q1 2011, finland, 5.33
20113, Q3 2011, denmark, 3.10
20113, Q3 2011, finland, 6.28

```json
{"plot":{"marks":[{"type":"lineY","x":"period_label","y":"value","stroke":"country","curve":"catmull-rom"}],"x":{"label":null},"y":{"label":"Reach %","grid":true},"color":{"legend":true}},"summary":"Reach varies by country over time. Finland consistently shows higher reach than Denmark across all measured quarters."}
```

Input columns: period_sort, period_label, service, value
Sample rows:
20251, Q1 2025, netflix, 0.42
20251, Q1 2025, disney, 0.18
20261, Q1 2026, netflix, 0.45
20261, Q1 2026, disney, 0.21

```json
{"plot":{"marks":[{"type":"barY","fx":"service","x":"period_label","y":"value","fill":"period_label"}],"fx":{"label":null},"x":{"axis":null},"y":{"label":"Penetration %","grid":true,"tickFormat":".0%"},"color":{"legend":true}},"summary":"Netflix grew from 42% to 45% between Q1 2025 and Q1 2026. Disney+ also climbed from 18% to 21%."}
```

Input columns: period_sort, period_label, service, value
Sample rows:
20251, Q1 2025, Netflix, 0.35
20251, Q1 2025, YouTube, 0.25
20251, Q1 2025, Disney+, 0.15
20251, Q1 2025, Others, 0.25
20261, Q1 2026, Netflix, 0.32
20261, Q1 2026, YouTube, 0.28
20261, Q1 2026, Disney+, 0.16
20261, Q1 2026, Others, 0.24

```json
{"plot":{"marks":[{"type":"barY","x":"period_label","y":"value","fill":"service"}],"x":{"label":null},"y":{"label":"Share of viewing","grid":true,"tickFormat":".0%"},"color":{"legend":true}},"summary":"YouTube gained share from 25% to 28%, while Netflix dropped from 35% to 32%. Disney+ remained stable."}
```

Respond with ONLY the ```json ... ``` block. No other text."""


def _build_system_prompt():
	return _PROMPT_HEADER + _PROMPT_EXAMPLES


async def generate_plot_and_summary(options):
	user_prompt     = options["user_prompt"]
	columns         = options["columns"]
	rows            = options["rows"]
	label           = options.get("label", "plot")
	log_id          = options.get("log_id")
	user            = options.get("user", "")
	conversation_id = options.get("conversation_id", "")
	prior_plot_config = options.get("prior_plot_config")

	sample = rows[:50]
	header = ", ".join(columns)
	lines = [header] + [", ".join(str(v) for v in row.values()) for row in sample]
	data_text = "\n".join(lines)
	user_msg = f"User question: {user_prompt}\n\nQuery result columns: {header}\nSample rows ({len(sample)}):\n{data_text}"
	for kpi_col in ("kpi_dimension", "kpi_type", "kpi_service"):
		if kpi_col in columns:
			vals = list(dict.fromkeys(str(r[kpi_col]) for r in rows if r.get(kpi_col)))
			if vals:
				user_msg += f"\n{kpi_col} values: {', '.join(vals)}"
	if prior_plot_config:
		prior_json = json.dumps(prior_plot_config, indent=2, default=str)
		user_msg += (
			"\n\nPrevious plot config (extend this — keep the same mark type and structure, "
			"just add/adjust fields for the new data):\n```json\n"
			+ prior_json
			+ "\n```"
		)
	system_prompt = _build_system_prompt()
	messages = [{"role": "user", "content": user_msg}]
	text = await llm.complete_text({
		"system": system_prompt,
		"messages": messages,
		"model": "sonnet",
		"label": label,
		"log_id": log_id,
		"user": user,
		"conversation_id": conversation_id,
	})
	plot, summary = extract_plot_and_summary(text)
	debug = {"prompt": system_prompt, "messages": messages, "response": text}
	return plot, summary, debug


async def generate_summary(prompt, columns, rows):
	# summary-only call (templates path) — no plot needed
	_plot, summary, _debug = await generate_plot_and_summary({
		"user_prompt": prompt,
		"columns": columns,
		"rows": rows,
		"label": "summary",
	})
	return summary


def extract_plot_and_summary(text):
	match = re.search(r"```json\s*(.*?)\s*```", text, re.DOTALL)
	if match:
		try:
			obj = json.loads(match.group(1).strip())
			return obj.get("plot"), obj.get("summary")
		except Exception as e:
			print(f"[plot] parse error: {e}")
			return None, None
	else:
		return None, None
