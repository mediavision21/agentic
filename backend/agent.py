import os
import re
import json
from datetime import datetime
from skills import load_skills
import llm_claude
import llm_local

LOGS_DIR = os.path.join(os.path.dirname(__file__), "..", "logs")


SYSTEM_PROMPT_TEMPLATE = """You are a SQL expert assistant. You generate PostgreSQL queries based on the user's natural language request.

## Database Schema
{schema}

## Rules
- Generate ONLY SELECT queries. Never generate INSERT, UPDATE, DELETE, DROP, or any mutating SQL.
- Wrap the SQL in a ```sql code fence.
- After the SQL, briefly explain what the query does in 1-2 sentences.
- Use the column names and types from the schema exactly.
- If the user's request is ambiguous, make a reasonable assumption and note it in the explanation.
"""


def build_prompt():
    skills = load_skills()
    schema_parts = []
    for name, content in skills["files"].items():
        schema_parts.append(content)
    return SYSTEM_PROMPT_TEMPLATE.format(schema="\n\n".join(schema_parts))


def extract_sql(text):
    # extract SQL from ```sql ... ``` code fence
    match = re.search(r"```sql\s*(.*?)\s*```", text, re.DOTALL)
    if match:
        return match.group(1).strip()
    # fallback: try to find SELECT statement
    match = re.search(r"(SELECT\s+.+?;)", text, re.DOTALL | re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return text.strip()


async def generate_sql(user_prompt, backend="claude"):
    system_prompt = build_prompt()

    # log request to LLM
    os.makedirs(LOGS_DIR, exist_ok=True)
    ts = datetime.now().strftime("%Y-%m-%d_%H:%M:%S")
    with open(os.path.join(LOGS_DIR, f"{ts}-request.txt"), "w") as f:
        f.write(f"backend: {backend}\n")
        f.write(f"prompt: {user_prompt}\n\n")
        f.write(f"system:\n{system_prompt}\n")

    if backend == "local":
        raw = await llm_local.complete(system_prompt, user_prompt)
        text = raw["choices"][0]["message"]["content"]
    else:
        raw = await llm_claude.complete(system_prompt, user_prompt)
        text = raw.content[0].text

    # log full response from LLM
    ts = datetime.now().strftime("%Y-%m-%d_%H:%M:%S")
    with open(os.path.join(LOGS_DIR, f"{ts}-response.json"), "w") as f:
        if backend == "local":
            json.dump(raw, f, indent=2, ensure_ascii=False)
        else:
            json.dump(raw.model_dump(), f, indent=2, ensure_ascii=False, default=str)

    sql = extract_sql(text)
    # extract explanation (text after the code fence)
    explanation = re.sub(r"```sql.*?```", "", text, flags=re.DOTALL).strip()

    return {"sql": sql, "explanation": explanation}
