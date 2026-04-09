import os
import yaml
import anthropic
import evaldb
from datetime import datetime


client = anthropic.AsyncAnthropic(api_key=os.getenv("API_KEY"))

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
    prompt = messages[-1]["content"] if messages else ""
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
        _write_log(label, system_prompt, messages, full_text, meta, log_id, user, conversation_id)
        yield {"__meta__": meta}


async def complete(system_prompt, messages, label="sonnet", log_id=None, user="", conversation_id=""):
    # messages: list of {"role": "user"|"assistant", "content": str}
    resp = await client.messages.create(
        model=MODEL,
        max_tokens=2048,
        temperature=0,
        # top_p=1,
        system=system_prompt,
        messages=messages,
    )
    meta = {"model": resp.model, "usage": resp.usage.model_dump()}
    _write_log(label, system_prompt, messages, resp.content[0].text, meta, log_id, user, conversation_id)
    return resp


async def complete_fast(system_prompt, messages):
    # lightweight haiku call for routing decisions
    resp = await client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=100,
        temperature=0,
        system=system_prompt,
        messages=messages,
    )
    meta = {"model": resp.model, "usage": resp.usage.model_dump()}
    _write_log("haiku", system_prompt, messages, resp.content[0].text, meta)
    return resp
