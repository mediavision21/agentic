import os
import yaml
import anthropic
import evaldb
from datetime import datetime


client = anthropic.AsyncAnthropic(api_key=os.getenv("API_KEY"))

# ANSI colors for terminal debug output
_C = {
    "reset":  "\033[0m",
    "bold":   "\033[1m",
    "cyan":   "\033[36m",
    "yellow": "\033[33m",
    "green":  "\033[32m",
    "magenta":"\033[35m",
    "blue":   "\033[34m",
    "red":    "\033[31m",
    "gray":   "\033[90m",
}

def _fmt(color, text): return f"{_C[color]}{text}{_C['reset']}"

# accent color per model family — used in the call/response header
def _accent_for_model(model):
    if model:
        m = model.lower()
        if "haiku" in m:
            return "blue"
        if "sonnet" in m:
            return "cyan"
        if "opus" in m:
            return "magenta"
    return "cyan"

def _divider_top(accent, label, model):
    bar = "══════"
    tag = f"[llm:{model.split('-')[1] if model and '-' in model else (model or '?')}]"
    header = f"{bar} {tag} {label} {bar}"
    print(f"{_C['bold']}{_C[accent]}{header}{_C['reset']}")

def _divider_bot(accent):
    print(f"{_C[accent]}{'─' * 60}{_C['reset']}")

def _log_call(label, messages, system_prompt, model=None):
    accent = _accent_for_model(model)
    _divider_top(accent, label, model or "?")
    sys_preview = system_prompt[:120].replace(chr(10), ' ')
    print(f"  {_fmt('gray', 'system:')} {sys_preview}{'…' if len(system_prompt) > 120 else ''}")
    for i, m in enumerate(messages):
        role = m.get("role", "?")
        content = m.get("content", "")
        if isinstance(content, list):
            # tool result / multi-part
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

def _log_response(label, text, stop_reason, usage, model=None, iteration=None, tool_blocks=None):
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

LOGS_DIR = os.path.join(os.path.dirname(__file__), "..", "logs")


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

# https://platform.claude.com/docs/en/about-claude/models/overview
# 1$/5$/M 		claude-haiku-4-5-20251001
# 3$/15$/M 		claude-sonnet-4-6
# 5$/25$/M 		claude-opus-4-6
# MODEL = "claude-haiku-4-5-20251001"
MODEL = "claude-sonnet-4-6"

async def complete_stream(system_prompt, messages, label="sonnet", log_id=None, user="", conversation_id=""):
    # messages: list of {"role": "user"|"assistant", "content": str}
    # yields text chunks, then a final {"__meta__": {...}} dict with usage info
    _log_call(label, messages, system_prompt, model=MODEL)
    full_text = ""
    async with client.messages.stream(
        model=MODEL,
        max_tokens=2048,
        temperature=0,
        # top_p=1, # claude-sonnet-4-6&claude-haiku-4-5-20251001 can not use temprature and top_p at the same time.
        system=system_prompt,
        messages=messages,
    ) as stream:
        async for text in stream.text_stream:
            full_text += text
            yield text
        final = await stream.get_final_message()
        meta = {"model": final.model, "usage": final.usage.model_dump()}
        _log_response(label, full_text, final.stop_reason, final.usage.model_dump(), model=final.model)
        _write_log(label, system_prompt, messages, full_text, meta, log_id, user, conversation_id)
        yield {"__meta__": meta}


async def complete(system_prompt, messages, label="sonnet", log_id=None, user="", conversation_id=""):
    # messages: list of {"role": "user"|"assistant", "content": str}
    _log_call(label, messages, system_prompt, model=MODEL)
    resp = await client.messages.create(
        model=MODEL,
        max_tokens=2048,
        temperature=0,
        # top_p=1,
        system=system_prompt,
        messages=messages,
    )
    meta = {"model": resp.model, "usage": resp.usage.model_dump()}
    full_text = resp.content[0].text if resp.content else ""
    _log_response(label, full_text, resp.stop_reason, resp.usage.model_dump(), model=resp.model)
    _write_log(label, system_prompt, messages, full_text, meta, log_id, user, conversation_id)
    return resp


async def complete_with_tools_stream(system_prompt, messages, tools, tool_handler, label="sonnet-tools", log_id=None, user="", conversation_id="", max_iterations=5):
    # messages: list of {"role": "user"|"assistant", "content": str | list}
    # tools: list of tool definitions per Anthropic API
    # tool_handler: async (name, input) -> {"content": str_for_llm, "events": [events_for_ui]}
    # yields:
    #   str  — text deltas from the model
    #   {"type": "tool_call", "name", "input", "id"} for each tool_use block
    #   {"type": "tool_result", "name", "id", "rows": int} after tool runs
    #   any events the tool_handler emits in its "events" list
    #   {"__meta__": {...}} as the final item with aggregated usage
    conv = [dict(m) for m in messages]
    total_input = 0
    total_output = 0
    model_name = MODEL
    full_assembled = ""
    for iteration in range(max_iterations):
        _log_call(f"{label} iter={iteration}", conv, system_prompt, model=MODEL)
        iter_text = ""
        async with client.messages.stream(
            model=MODEL,
            max_tokens=4096,
            temperature=0,
            system=system_prompt,
            messages=conv,
            tools=tools,
        ) as stream:
            async for text in stream.text_stream:
                iter_text += text
                yield text
            final = await stream.get_final_message()
        full_assembled += iter_text
        model_name = final.model
        usage = final.usage.model_dump()
        total_input += usage.get("input_tokens", 0) or 0
        total_output += usage.get("output_tokens", 0) or 0
        iter_meta = {"model": final.model, "usage": usage}
        tool_blocks = [b for b in final.content if b.type == "tool_use"]
        _log_response(label, iter_text, final.stop_reason, usage, model=final.model, iteration=iteration, tool_blocks=tool_blocks)
        _write_log(f"{label}-iter{iteration}", system_prompt, conv, iter_text, iter_meta, log_id, user, conversation_id)

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
        print(f"[llm_claude] tool loop hit max_iterations={max_iterations}")

    meta = {"model": model_name, "usage": {"input_tokens": total_input, "output_tokens": total_output}}
    yield {"__meta__": meta}


HAIKU_MODEL = "claude-haiku-4-5-20251001"

async def complete_fast(system_prompt, messages, label="haiku"):
    # lightweight haiku call for routing / filter-resolution decisions
    _log_call(label, messages, system_prompt, model=HAIKU_MODEL)
    resp = await client.messages.create(
        model=HAIKU_MODEL,
        max_tokens=100,
        temperature=0,
        system=system_prompt,
        messages=messages,
    )
    meta = {"model": resp.model, "usage": resp.usage.model_dump()}
    full_text = resp.content[0].text if resp.content else ""
    _log_response(label, full_text, resp.stop_reason, resp.usage.model_dump(), model=resp.model)
    _write_log(label, system_prompt, messages, full_text, meta)
    return resp
