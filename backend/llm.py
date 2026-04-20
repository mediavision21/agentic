import os
import json
import yaml
import anthropic
import evaldb
from datetime import datetime


client = anthropic.AsyncAnthropic(api_key=os.getenv("API_KEY"))

# https://platform.claude.com/docs/en/about-claude/models/overview
# 1$/5$/M 	claude-haiku-4-5-20251001
# 3$/15$/M 	claude-sonnet-4-6
# 5$/25$/M 	claude-opus-4-6
MODELS = {
	"sonnet": "claude-sonnet-4-6",
	"haiku":  "claude-haiku-4-5-20251001",
}

LOGS_DIR = os.path.join(os.path.dirname(__file__), "..", "logs")


# ANSI colors for terminal debug output
_C = {
	"reset":   "\033[0m",
	"bold":    "\033[1m",
	"cyan":    "\033[36m",
	"yellow":  "\033[33m",
	"green":   "\033[32m",
	"magenta": "\033[35m",
	"blue":    "\033[34m",
	"red":     "\033[31m",
	"gray":    "\033[90m",
}

def _fmt(color, text): return f"{_C[color]}{text}{_C['reset']}"

def _accent_for_model(model):
	if model:
		m = model.lower()
		if "haiku"  in m: return "blue"
		if "sonnet" in m: return "cyan"
		if "opus"   in m: return "magenta"
	return "cyan"

def _divider_top(accent, label, model):
	bar = "══════"
	tag = f"[llm:{model.split('-')[1] if model and '-' in model else (model or '?')}]"
	header = f"{bar} {tag} {label} {bar}"
	print(f"{_C['bold']}{_C[accent]}{header}{_C['reset']}")

def _divider_bot(accent):
	print(f"{_C[accent]}{'─' * 60}{_C['reset']}")

def _log_call(label, messages, system_prompt, model):
	accent = _accent_for_model(model)
	_divider_top(accent, label, model or "?")
	sys_preview = system_prompt[:120].replace(chr(10), ' ')
	print(f"  {_fmt('gray', 'system:')} {sys_preview}{'…' if len(system_prompt) > 120 else ''}")
	for i, m in enumerate(messages):
		role = m.get("role", "?")
		content = m.get("content", "")
		if isinstance(content, list):
			parts = []
			for part in content:
				if isinstance(part, dict):
					t = part.get("type", "")
					if t == "tool_result":
						parts.append(f"tool_result({part.get('tool_use_id','')[:8]})")
					elif t == "tool_use":
						parts.append(f"tool_use:{part.get('name','')}({str(part.get('input',''))[:60]})")
					elif t == "text":
						parts.append(f"text:{part.get('text','')[:60]}")
					else:
						parts.append(str(part)[:60])
			summary = " | ".join(parts)
		else:
			summary = str(content)[:120].replace("\n", " ")
		color = "yellow" if role == "user" else "green"
		print(f"  {_fmt(color, f'[{i}] {role}:')} {summary}")

def _log_response(label, text, stop_reason, usage, model, iteration=None, tool_blocks=None):
	accent = _accent_for_model(model)
	iter_tag = f" iter={iteration}" if iteration is not None else ""
	mdl = f" {model}" if model else ""
	print(f"  {_fmt(accent, f'←{mdl} {label}{iter_tag}')} stop={stop_reason} in={usage.get('input_tokens',0)} out={usage.get('output_tokens',0)}")
	if text:
		preview = text[:200].replace("\n", " ")
		print(f"  {_fmt('blue', 'response:')} {preview}{'…' if len(text) > 200 else ''}")
	if tool_blocks:
		for b in tool_blocks:
			sql = b.input.get("sql", "") if hasattr(b, "input") else ""
			sql_preview = sql[:120].replace("\n", " ") if sql else str(getattr(b, "input", ""))[:120]
			print(f"  {_fmt('red', f'tool_use: {b.name}')} id={b.id[:8]} input={sql_preview}")
	_divider_bot(accent)


def _write_log(label, system_prompt, messages, full_text, meta, log_id=None, user="", conversation_id=""):
	os.makedirs(LOGS_DIR, exist_ok=True)
	ts = datetime.now().strftime("%Y-%m-%d_%H:%M:%S")
	with open(os.path.join(LOGS_DIR, f"{ts}-{label}-request.md"), "w") as f:
		f.write(f"system:\n{system_prompt}\n\nmessages:\n{messages}\n")
	with open(os.path.join(LOGS_DIR, f"{ts}-{label}-response.yaml"), "w") as f:
		yaml.dump({
			"model": meta.get("model", ""), "usage": meta.get("usage", {}),
			"response": full_text,
		}, f, default_flow_style=False, allow_unicode=True)
	if messages:
		last_content = messages[-1]["content"]
		if isinstance(last_content, str):
			prompt = last_content
		else:
			prompt = yaml.dump(last_content, default_flow_style=False, allow_unicode=True)
	else:
		prompt = ""
	evaldb.save_log(
		log_id or datetime.now().strftime("%Y-%m-%d %H:%M:%S") + f".{datetime.now().microsecond * 1000:09d}",
		prompt, system_prompt, messages, full_text,
		meta.get("model", ""), meta.get("usage", {}),
		user=user, conversation_id=conversation_id,
	)


# single unified entrypoint — streams tokens, emits prompt/messages/response per iteration,
# each tool-use iteration is its own visible round.
async def complete(options):
	system_prompt   = options["system"]
	messages        = options["messages"]
	model_key       = options.get("model", "sonnet")
	tools           = options.get("tools")
	tool_handler    = options.get("tool_handler")
	max_iterations  = options.get("max_iterations", 5) if tools else 1
	label           = options.get("label", "llm")
	log_id          = options.get("log_id")
	user            = options.get("user", "")
	conversation_id = options.get("conversation_id", "")
	max_tokens      = options.get("max_tokens", 100 if model_key == "haiku" else 4096)

	prefill        = options.get("prefill")
	stop_sequences = options.get("stop_sequences")

	model = MODELS[model_key]
	conv = [dict(m) for m in messages]
	total_input = 0
	total_output = 0
	final_model = model

	for iteration in range(max_iterations):
		iter_label = f"{label} iter={iteration}" if tools else label
		_log_call(iter_label, conv, system_prompt, model=model)
		# one round per iteration — frontend renders each as its own <details> block
		yield {"type": "round",    "label": iter_label}
		yield {"type": "prompt",   "text": system_prompt}
		yield {"type": "messages", "messages": [dict(m) for m in conv]}

		iter_text = ""
		call_conv = conv
		if prefill and iteration == 0:
			call_conv = conv + [{"role": "assistant", "content": prefill}]
		stream_kwargs = {
			"model": model,
			"max_tokens": max_tokens,
			"temperature": 0,
			"system": system_prompt,
			"messages": call_conv,
		}
		if tools:
			stream_kwargs["tools"] = tools
		if stop_sequences:
			stream_kwargs["stop_sequences"] = stop_sequences

		async with client.messages.stream(**stream_kwargs) as stream:
			async for text in stream.text_stream:
				iter_text += text
				yield {"type": "token", "text": text}
			final = await stream.get_final_message()

		final_model = final.model
		usage = final.usage.model_dump()
		total_input  += usage.get("input_tokens", 0)  or 0
		total_output += usage.get("output_tokens", 0) or 0
		tool_blocks = [b for b in final.content if b.type == "tool_use"]
		_log_response(label, iter_text, final.stop_reason, usage, model=final.model, iteration=iteration if tools else None, tool_blocks=tool_blocks)
		_write_log(f"{label}-iter{iteration}" if tools else label, system_prompt, conv, iter_text, {"model": final.model, "usage": usage}, log_id, user, conversation_id)

		# build the response text to include any tool_use blocks so the RESPONSE
		# section of this round shows what Claude actually emitted (often pure
		# tool_use with no prose on first iteration).
		response_parts = []
		if iter_text.strip():
			response_parts.append(iter_text.strip())
		for b in tool_blocks:
			sql_val = b.input.get("sql") if isinstance(b.input, dict) else None
			if sql_val:
				response_parts.append(f"→ tool_use: {b.name}\n```sql\n{sql_val}\n```")
			else:
				response_parts.append(f"→ tool_use: {b.name}\n```json\n{json.dumps(b.input, indent=2, default=str)}\n```")
		response_text = "\n\n".join(response_parts) if response_parts else iter_text
		yield {"type": "response", "text": response_text}

		# no tools — single pass, exit
		if tools:
			if final.stop_reason != "tool_use":
				break

			assistant_content = []
			for block in final.content:
				if block.type == "text":
					assistant_content.append({"type": "text", "text": block.text})
				elif block.type == "tool_use":
					assistant_content.append({"type": "tool_use", "id": block.id, "name": block.name, "input": block.input})
			conv.append({"role": "assistant", "content": assistant_content})

			tool_results = []
			for block in final.content:
				if block.type == "tool_use":
					yield {"type": "tool_call", "name": block.name, "input": block.input, "id": block.id}
					handler_result = await tool_handler(block.name, block.input)
					for ev in handler_result.get("events", []):
						yield ev
					content_str = handler_result.get("content", "")
					rows_n = handler_result.get("rows", 0)
					print(f"  {_fmt('yellow', f'tool_result: {block.name}')} id={block.id[:8]} rows={rows_n} content_len={len(content_str)}")
					tool_results.append({
						"type": "tool_result",
						"tool_use_id": block.id,
						"content": content_str,
					})
					yield {"type": "tool_result", "name": block.name, "id": block.id, "rows": rows_n}
			conv.append({"role": "user", "content": tool_results})
		else:
			break
	else:
		print(f"[llm] tool loop hit max_iterations={max_iterations}")

	yield {"type": "meta", "model": final_model, "usage": {"input_tokens": total_input, "output_tokens": total_output}}


# convenience wrapper for callers that just need the final text string (no streaming)
async def complete_text(options):
	full = ""
	async for ev in complete(options):
		if ev.get("type") == "token":
			full += ev["text"]
	return full.strip()
