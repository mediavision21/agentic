import llm_claude
import llm_local


async def complete_stream(system_prompt, messages, options):
    # options: {backend, label, log_id, user, conversation_id}
    # yields text chunks, then {"__meta__": ...}
    backend = options.get("backend", "claude")
    label = options.get("label", "llm")
    log_id = options.get("log_id")
    user = options.get("user", "")
    conversation_id = options.get("conversation_id", "")
    if backend == "local":
        async for chunk in llm_local.complete_stream(system_prompt, messages, label=label, log_id=log_id, user=user, conversation_id=conversation_id):
            yield chunk
    else:
        async for chunk in llm_claude.complete_stream(system_prompt, messages, label=label, log_id=log_id, user=user, conversation_id=conversation_id):
            yield chunk


async def complete(system_prompt, messages, options):
    # options: {backend, label, log_id, user, conversation_id}
    # returns: normalized text string
    backend = options.get("backend", "claude")
    label = options.get("label", "llm")
    log_id = options.get("log_id")
    user = options.get("user", "")
    conversation_id = options.get("conversation_id", "")
    if backend == "local":
        raw = await llm_local.complete(system_prompt, messages, label=label, log_id=log_id, user=user, conversation_id=conversation_id)
        return raw["choices"][0]["message"]["content"].strip()
    else:
        raw = await llm_claude.complete(system_prompt, messages, label=label, log_id=log_id, user=user, conversation_id=conversation_id)
        return raw.content[0].text.strip()


async def complete_fast(system_prompt, messages):
    # lightweight haiku call — always claude, returns text string
    resp = await llm_claude.complete_fast(system_prompt, messages)
    return resp.content[0].text.strip()
