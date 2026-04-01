import os
import re
import yaml
from datetime import datetime
import llm_claude
import llm_local
import evaldb
from db import execute_query
from stage2 import (
    extract_sql, postprocess_sql, extract_plot_config,
    generate_summary, build_system_prompt, build_messages,
    LOGS_DIR,
)


async def run(options):
    prompt = options["prompt"]
    backend = options["backend"]
    history = options["history"]
    msg_id = options["msg_id"]
    user = options["user"]
    conversation_id = options["conversation_id"]

    # full skills/schema prompt — no template hints
    system_prompt = build_system_prompt()
    messages = build_messages(history, prompt)
    print(f"[stage3] full schema prompt, no template hints")

    os.makedirs(LOGS_DIR, exist_ok=True)
    ts = datetime.now().strftime("%Y-%m-%d_%H:%M:%S")
    with open(os.path.join(LOGS_DIR, f"{ts}-stage3-request.md"), "w") as f:
        f.write(f"backend: {backend}\nprompt: {prompt}\n\nsystem:\n{system_prompt}\n")

    full_text = ""
    meta = {}
    stream_fn = llm_local.complete_stream if backend == "local" else llm_claude.complete_stream
    async for chunk in stream_fn(system_prompt, messages):
        if isinstance(chunk, dict):
            meta = chunk.get("__meta__", {})
            break
        full_text += chunk
        print(chunk, end="", flush=True)
        yield {"type": "token", "text": chunk}
    print()

    ts = datetime.now().strftime("%Y-%m-%d_%H:%M:%S")
    with open(os.path.join(LOGS_DIR, f"{ts}-stage3-response.md"), "w") as f:
        f.write(full_text)
    with open(os.path.join(LOGS_DIR, f"{ts}-stage3-response.yaml"), "w") as f:
        yaml.dump({
            "backend": backend, "prompt": prompt,
            "model": meta.get("model", ""), "usage": meta.get("usage", {}),
            "response": full_text,
        }, f, default_flow_style=False, allow_unicode=True)

    sql_raw = extract_sql(full_text)

    if sql_raw is None:
        suggestions = []
        sugg_match = re.search(r"<!--suggestions\s*(.*?)\s*-->", full_text, re.DOTALL)
        if sugg_match:
            suggestions = [line.strip() for line in sugg_match.group(1).splitlines() if line.strip()]
        display_text = re.sub(r"\s*<!--suggestions.*?-->", "", full_text, flags=re.DOTALL).strip()
        yield {"type": "text", "text": display_text}
        if suggestions:
            yield {"type": "suggestions", "items": suggestions}
        evaldb.save_log(msg_id, prompt, system_prompt, messages, full_text,
            meta.get("model", ""), meta.get("usage", {}), user=user, conversation_id=conversation_id)
        return

    sql = postprocess_sql(sql_raw)
    plot_config = extract_plot_config(full_text)
    explanation = re.sub(r"```(?:sql|json).*?```", "", full_text, flags=re.DOTALL).strip()

    with open(os.path.join(LOGS_DIR, f"{ts}-stage3-sql.md"), "w") as f:
        f.write(f"## raw\n```sql\n{sql_raw}\n```\n\n## post-processed\n```sql\n{sql}\n```\n")

    yield {"type": "sql", "sql": sql, "plot_config": plot_config, "explanation": explanation}

    result_data = {}
    try:
        data = await execute_query(sql)
        yield {"type": "rows", "columns": data["columns"], "rows": data["rows"]}
        result_data = {"columns": data["columns"], "rows": data["rows"], "plot_config": plot_config}
    except Exception as e:
        print(f"[stage3] query error: {e}")
        yield {"type": "error", "error": f"SQL error: {e}"}
        evaldb.save_log(msg_id, prompt, system_prompt, messages, full_text,
            meta.get("model", ""), meta.get("usage", {}), user=user, conversation_id=conversation_id)
        return

    try:
        summary = await generate_summary(prompt, data["columns"], data["rows"], backend)
        yield {"type": "summary", "text": summary}
        result_data["summary"] = summary
    except Exception as e:
        print(f"[stage3] summary error: {e}")

    evaldb.save_log(msg_id, prompt, system_prompt, messages, full_text,
        meta.get("model", ""), meta.get("usage", {}),
        user=user, conversation_id=conversation_id, result_data=result_data)
