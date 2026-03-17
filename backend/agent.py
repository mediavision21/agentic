import re
from skills import load_skills
import llm_claude
import llm_local


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

    if backend == "local":
        response = await llm_local.complete(system_prompt, user_prompt)
    else:
        response = await llm_claude.complete(system_prompt, user_prompt)

    sql = extract_sql(response)
    # extract explanation (text after the code fence)
    explanation = re.sub(r"```sql.*?```", "", response, flags=re.DOTALL).strip()

    return {"sql": sql, "explanation": explanation}
