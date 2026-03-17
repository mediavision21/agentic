import os
import anthropic


client = anthropic.AsyncAnthropic(api_key=os.getenv("API_KEY"))

# https://platform.claude.com/docs/en/about-claude/models/overview
# 1$/5$/M 		claude-haiku-4-5-20251001
# 3$/15$/M 		claude-sonnet-4-6
# 5$/25$/M 		claude-opus-4-6
async def complete(system_prompt, user_message):
    response = await client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=2048,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    )
    return response
