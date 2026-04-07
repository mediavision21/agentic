import re
import llm_claude
import llm_local
import evaldb
from db import execute_query
from stage2 import (
    extract_sql, postprocess_sql, extract_plot_config,
    generate_summary, build_system_prompt, build_messages,
    load_data_examples,
)


async def run(options):
    prompt = options["prompt"]
    backend = options["backend"]
    history = options["history"]
    msg_id = options["msg_id"]
    user = options["user"]
    conversation_id = options["conversation_id"]

    # full skills/schema prompt — no template hints
    data_examples = await load_data_examples()
    system_prompt = build_system_prompt(data_examples)
    messages = build_messages(history, prompt)
    print(f"[stage3] full schema prompt, no template hints")

    full_text = ""
    stream_fn = llm_local.complete_stream if backend == "local" else llm_claude.complete_stream
    async for chunk in stream_fn(system_prompt, messages, label="stage3", log_id=msg_id, user=user, conversation_id=conversation_id):
        if isinstance(chunk, dict):
            break
        full_text += chunk
        print(chunk, end="", flush=True)
        yield {"type": "token", "text": chunk}
    print()

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
        return

    sql = postprocess_sql(sql_raw)
    plot_config = extract_plot_config(full_text)
    explanation = re.sub(r"```(?:sql|json).*?```", "", full_text, flags=re.DOTALL).strip()

    yield {"type": "sql", "sql": sql, "plot_config": plot_config, "explanation": explanation}

    result_data = {}
    try:
        data = await execute_query(sql)
        yield {"type": "rows", "columns": data["columns"], "rows": data["rows"]}
        result_data = {"columns": data["columns"], "rows": data["rows"], "plot_config": plot_config}
    except Exception as e:
        print(f"[stage3] query error: {e}")
        yield {"type": "error", "error": f"SQL error: {e}"}
        return

    try:
        summary = await generate_summary(prompt, data["columns"], data["rows"], backend)
        yield {"type": "summary", "text": summary}
        result_data["summary"] = summary
    except Exception as e:
        print(f"[stage3] summary error: {e}")

    evaldb.update_result_data(msg_id, result_data)
