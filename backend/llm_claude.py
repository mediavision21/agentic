import os
import anthropic


client = anthropic.AsyncAnthropic(api_key=os.getenv("API_KEY"))


async def complete(system_prompt, user_message):
    response = await client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2048,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    )
    return response.content[0].text
