import os
import anthropic


client = anthropic.AsyncAnthropic(api_key=os.getenv("API_KEY"))

# https://platform.claude.com/docs/en/about-claude/models/overview
# 1$/5$/M 		claude-haiku-4-5-20251001
# 3$/15$/M 		claude-sonnet-4-6
# 5$/25$/M 		claude-opus-4-6
MODEL = "claude-haiku-4-5-20251001"

async def complete_stream(system_prompt, user_message):
    # yields text chunks, then a final {"__meta__": {...}} dict with usage info
    async with client.messages.stream(
        model=MODEL,
        max_tokens=2048,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
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


async def complete(system_prompt, user_message):
    return await client.messages.create(
        model=MODEL,
        max_tokens=2048,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    )
