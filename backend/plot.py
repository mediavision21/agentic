import re
import json
import os
import yaml
import llm


def _load_prompt(version="v2"):
    path = os.path.join(os.path.dirname(__file__), f"plot-{version}.yaml")
    with open(path) as f:
        return yaml.safe_load(f)

_prompt_data = _load_prompt()


def _build_system_prompt(prompt_data=None):
    data = prompt_data or _prompt_data
    return data["header"] + data["examples"]


async def generate_plot_and_summary(options):
	user_prompt     = options["user_prompt"]
	columns         = options["columns"]
	rows            = options["rows"]
	label           = options.get("label", "plot")
	log_id          = options.get("log_id")
	user            = options.get("user", "")
	conversation_id = options.get("conversation_id", "")
	prior_plot_config = options.get("prior_plot_config")
	prompt_data = options.get("prompt_data")

	sample = rows[:50]
	header = ", ".join(columns)
	lines = [header] + [", ".join(str(v) for v in row.values()) for row in sample]
	data_text = "\n".join(lines)
	user_msg = f"User question: {user_prompt}\n\nQuery result: \n{data_text}"
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
	system_prompt = _build_system_prompt(prompt_data)
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
	plot, summary, key_takeaways = extract_plot_and_summary(text)
	debug = {"prompt": system_prompt, "messages": messages, "response": text}
	return plot, summary, key_takeaways, debug


async def generate_simple_summary(options):
	user_prompt     = options["user_prompt"]
	columns         = options["columns"]
	rows            = options["rows"]
	log_id          = options.get("log_id")
	user            = options.get("user", "")
	conversation_id = options.get("conversation_id", "")

	header = ", ".join(columns)
	lines = [header] + [", ".join(str(v) for v in row.values()) for row in rows]
	data_text = "\n".join(lines)
	messages = [{"role": "user", "content": f"Answer this question in 1-2 sentences based on the data.\n\nQuestion: {user_prompt}\n\nData:\n{data_text}"}]
	text = await llm.complete_text({
		"system": "You are a helpful data analyst. Answer the user's question in 1-2 sentences based on the data provided.",
		"messages": messages,
		"model": "haiku",
		"label": "simple-summary",
		"log_id": log_id,
		"user": user,
		"conversation_id": conversation_id,
	})
	debug = {"prompt": "", "messages": messages, "response": text}
	return text.strip(), debug


async def generate_summary(prompt, columns, rows):
	# summary-only call (templates path) — no plot needed
	_plot, summary, _key_takeaways, _debug = await generate_plot_and_summary({
		"user_prompt": prompt,
		"columns": columns,
		"rows": rows,
		"label": "summary",
	})
	return summary


def extract_plot_and_summary(text):
	print(f"[plot] extract ({len(text)} chars): {repr(text[:120])}")
	match = re.search(r"```json\s*(.*?)\s*```", text, re.DOTALL)
	if match:
		try:
			obj = json.loads(match.group(1).strip())
			return obj.get("plot"), obj.get("summary"), []
		except Exception as e:
			print(f"[plot] parse error: {e}")
	return None, None, []
