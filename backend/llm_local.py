import os
import httpx


LLAMA_SERVER_URL = os.getenv("LLAMA_SERVER_URL", "http://localhost:8081")


async def complete(system_prompt, user_message):
    url = f"{LLAMA_SERVER_URL}/v1/chat/completions"
    payload = {
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        "temperature": 0.1,
        "max_tokens": 2048,
    }
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(url, json=payload)
        resp.raise_for_status()
        data = resp.json()
    return data
