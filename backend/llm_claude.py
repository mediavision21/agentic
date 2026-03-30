import os
import anthropic


client = anthropic.AsyncAnthropic(api_key=os.getenv("API_KEY"))

# https://platform.claude.com/docs/en/about-claude/models/overview
# 1$/5$/M 		claude-haiku-4-5-20251001
# 3$/15$/M 		claude-sonnet-4-6
# 5$/25$/M 		claude-opus-4-6
# MODEL = "claude-haiku-4-5-20251001"
MODEL = "claude-sonnet-4-6"

async def complete_stream(system_prompt, messages):
    # messages: list of {"role": "user"|"assistant", "content": str}
    # yields text chunks, then a final {"__meta__": {...}} dict with usage info
    async with client.messages.stream(
        model=MODEL,
        max_tokens=2048,
        temperature=0,
        # top_p=1, # claude-sonnet-4-6&claude-haiku-4-5-20251001 can not use temprature and top_p at the same time. 
        system=system_prompt,
        messages=messages,
    ) as stream:
        async for text in stream.text_stream:
            yield text
        final = await stream.get_final_message()
        yield {
            "__meta__": {
                "model": final.model,
                "usage": final.usage.model_dump(),
            }
        }


async def complete(system_prompt, messages):
    # messages: list of {"role": "user"|"assistant", "content": str}
    return await client.messages.create(
        model=MODEL,
        max_tokens=2048,
        temperature=0,
        # top_p=1,
        system=system_prompt,
        messages=messages,
    )


async def complete_fast(system_prompt, messages):
    # lightweight haiku call for routing decisions
    return await client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=100,
        temperature=0,
        system=system_prompt,
        messages=messages,
    )
