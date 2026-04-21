from datetime import datetime
import generate
import evaldb
from template_router import load_templates, match_top_templates, run_matched_template
from intent import extract_intent, is_data_query, resolve_defaults, build_preamble, build_suggestions, build_intent_prompt_block
from verify import verify_rows


def make_timestamp_id():
	now = datetime.now()
	return now.strftime("%Y-%m-%d %H:%M:%S") + f".{now.microsecond * 1000:09d}"


# mirror every SSE event into a single `content` dict — same shape the frontend
# assembles live in App.jsx handleSubmit. this dict is persisted at stream end
# so that reloading chat history renders identically to live streaming.
def _collect(event, content):
	t = event.get("type")
	if t == "msg_id":
		content["msg_id"] = event["id"]
	elif t == "preamble":
		content["preamble"] = event["text"]
	elif t == "intent":
		content["intent"] = event["intent"]
	elif t == "token":
		content["streaming_text"] = (content.get("streaming_text") or "") + event["text"]
	elif t == "text":
		content["text"] = event["text"]
		content["raw_text"] = event["text"]
	elif t == "sql":
		content["sql"] = event["sql"]
		if event.get("explanation"):
			content["explanation"] = event["explanation"]
		if event.get("plot_config") is not None:
			content["plot_config"] = event["plot_config"]
		if content.get("streaming_text"):
			content["raw_text"] = content["streaming_text"]
		if content["rounds"]:
			content["rounds"][-1]["sql"] = event["sql"]
	elif t == "rows":
		content["columns"] = event["columns"]
		content["rows"] = event["rows"]
		if content["rounds"]:
			content["rounds"][-1]["columns"] = event["columns"]
			content["rounds"][-1]["rows"] = event["rows"]
	elif t == "explanation":
		content["explanation"] = event["text"]
	elif t == "summary":
		content["summary"] = event["text"]
	elif t == "suggestions":
		content["suggestions"] = event["items"]
	elif t == "key_takeaways":
		content["key_takeaways"] = event["items"]
	elif t == "plot_config":
		content["plot_config"] = event["plot_config"]
	elif t == "no_plot":
		content["no_plot"] = True
	elif t == "template_plots":
		content["template_plots"] = event["plots"]
	elif t == "distilled_summary":
		content["distilled_summary"] = event["text"]
	elif t == "round":
		content["rounds"].append({"label": event["label"]})
	elif t == "prompt":
		if content["rounds"]:
			content["rounds"][-1]["prompt"] = event["text"]
	elif t == "messages":
		if content["rounds"]:
			content["rounds"][-1]["messages"] = event["messages"]
	elif t == "response":
		if content["rounds"]:
			content["rounds"][-1]["response"] = event["text"]
	elif t == "tool_call":
		if content["rounds"]:
			r = content["rounds"][-1]
			if "tool_calls" not in r:
				r["tool_calls"] = []
			r["tool_calls"].append({"name": event["name"], "input": event["input"], "id": event["id"]})
	elif t == "tool_result":
		if content["rounds"]:
			for tc in content["rounds"][-1].get("tool_calls", []):
				if tc["id"] == event["id"]:
					tc["rows"] = event["rows"]
					break
	elif t == "user_prompt":
		content["user_prompt"] = event["text"]
	elif t == "error":
		content["error"] = event["error"]


# strong signals that indicate a self-contained new question
_STRONG_SIGNAL_KEYS = ("kpi_type", "service_ids", "top_n", "countries", "category", "service_filter")


def _last_assistant_ctx(history):
	# walk history in reverse, return the most recent assistant turn that has sql+intent attached
	for h in reversed(history or []):
		if h.get("role") == "assistant" and h.get("sql") and h.get("intent"):
			return h
	return None


def is_continuation(partial, prior_ctx):
	if prior_ctx is None:
		return False
	if not is_data_query(partial):
		return True
	has_strong = any(partial.get(k) for k in _STRONG_SIGNAL_KEYS)
	if has_strong:
		return False
	return True


def _merge_partial_over_intent(prior_intent, partial):
	merged = {}
	for k in ("kpi_type", "kpi_dimension", "kpi_detail", "category", "countries",
			  "service_ids", "service_filter", "top_n", "year", "quarter",
			  "trend_mode", "age_group", "population_segment", "service_level",
			  "video_type_comparison"):
		if prior_intent.get(k) is not None:
			merged[k] = prior_intent[k]
	for k, v in partial.items():
		merged[k] = v
	return merged


async def generate_agent_stream(prompt, history=None, user="", conversation_id=""):
	content = {"loading": False, "rounds": []}
	try:
		async for event in _generate_agent_stream_inner(prompt, history, user, conversation_id):
			_collect(event, content)
			yield event
	finally:
		msg_id = content.get("msg_id")
		if msg_id:
			try:
				evaldb.update_result_data(msg_id, content)
			except Exception as e:
				print(f"[agent] persist content failed: {e}")


async def _generate_agent_stream_inner(prompt, history=None, user="", conversation_id=""):
	if history is None:
		history = []

	if not conversation_id:
		conversation_id = make_timestamp_id()
	yield {"type": "conversation_id", "id": conversation_id}

	msg_id = make_timestamp_id()
	yield {"type": "msg_id", "id": msg_id}
	yield {"type": "user_prompt", "text": prompt}

	# stage 0: intent resolution — extract + resolve defaults
	partial = extract_intent(prompt)

	# continuation detection — default to continue unless clearly a new question
	prior_ctx = _last_assistant_ctx(history)
	continuation = is_continuation(partial, prior_ctx)
	prior_sql = None
	prior_plot_config = None
	if continuation:
		prior_sql = prior_ctx.get("sql")
		prior_plot_config = prior_ctx.get("plot_config")
		prior_intent = prior_ctx.get("intent") or {}
		partial = _merge_partial_over_intent(prior_intent, partial)
		print(f"[agent] continuation detected — merged partial: {partial}")

	intent = None
	intent_block = ""
	if is_data_query(partial):
		intent = resolve_defaults(partial)
		preamble = build_preamble(intent)
		intent_block = build_intent_prompt_block(intent)
		print(f"[intent] resolved: kpi={intent['kpi_type']} dim={intent.get('kpi_dimension')} countries={intent.get('countries')} defaults={intent.get('applied_defaults')}")
		yield {"type": "preamble", "text": preamble}
		yield {"type": "intent", "intent": intent}

	# on continuation, skip template routing — go straight to tool-loop so LLM can modify prior SQL
	templates = {}
	matches = []
	match_debug = None
	template_fallback_feedback = None
	if not continuation:
		templates = load_templates()
		if templates:
			matches, match_debug = await match_top_templates(prompt, templates)

		# stage 1: routing — always surface the Haiku call, even when it returned NONE / errored
		if match_debug:
			yield {"type": "round", "label": "Routing"}
			yield {"type": "prompt", "text": match_debug["prompt"]}
			yield {"type": "messages", "messages": match_debug["messages"]}
			yield {"type": "response", "text": match_debug["response"] or "(no response)"}
		if matches and matches[0]["score"] >= 0.95:
			yield {"type": "round", "label": "Template Execution"}
			distilled = ""
			template_events = []
			template_cols = None
			template_rows = None
			async for event in run_matched_template({
				"prompt": prompt,
				"match": matches[0],
				"template": templates[matches[0]["file"]],
				"msg_id": msg_id,
				"user": user,
				"conversation_id": conversation_id,
				"intent": intent,
			}):
				if event.get("type") == "summary":
					distilled = event.get("text", "")
				elif event.get("type") == "text" and not distilled:
					distilled = event.get("text", "")[:500]
				elif event.get("type") == "rows":
					template_cols = event["columns"]
					template_rows = event["rows"]
				elif event.get("type") == "error":
					template_rows = []
				template_events.append(event)

			verdict = await verify_rows(prompt, template_cols, template_rows or [])
			print(f"[agent] template verify: ok={verdict['ok']} reason={verdict['reason']}")
			if verdict["ok"]:
				for e in template_events:
					yield e
				if intent:
					yield {"type": "suggestions", "items": build_suggestions(intent)}
				if distilled:
					yield {"type": "distilled_summary", "text": distilled}
				return
			template_fallback_feedback = verdict["reason"]

	# stage 2: tool-loop generation — LLM with `query` tool, optional template hints
	if continuation:
		label = "Follow-up Generation"
	elif matches:
		label = "Guided Generation"
	else:
		label = "Open Generation"
	distilled = ""
	suggestions_yielded = False
	async for event in generate.run({
		"prompt": prompt,
		"matches": matches,
		"templates": templates,
		"history": history,
		"msg_id": msg_id,
		"user": user,
		"conversation_id": conversation_id,
		"intent_block": intent_block,
		"prior_sql": prior_sql,
		"prior_plot_config": prior_plot_config,
		"label": label,
		"template_fallback_feedback": template_fallback_feedback,
	}):
		if event.get("type") == "summary":
			distilled = event.get("text", "")
		elif event.get("type") == "text" and not distilled:
			distilled = event.get("text", "")[:500]
		elif event.get("type") == "suggestions":
			suggestions_yielded = True
		yield event
	if intent and not suggestions_yielded:
		yield {"type": "suggestions", "items": build_suggestions(intent)}
	if distilled:
		yield {"type": "distilled_summary", "text": distilled}
