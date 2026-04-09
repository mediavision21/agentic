import re
import llm
import evaldb
from db import execute_query
from stage2 import extract_sqls, postprocess_sql, build_system_prompt, build_messages
from plot_config import generate_plot_and_summary
from data_examples import load_data_examples, load_kpi_combinations


async def run(options):
    prompt = options["prompt"]
    backend = options["backend"]
    history = options["history"]
    msg_id = options["msg_id"]
    user = options["user"]
    conversation_id = options["conversation_id"]
    intent_block = options.get("intent_block", "")

    # full skills/schema prompt — no template hints
    data_examples = await load_data_examples()
    kpi_combinations = await load_kpi_combinations()
    system_prompt = await build_system_prompt(data_examples, kpi_combinations, intent_block)
    messages = build_messages(history, prompt)
    print(f"[stage3] full schema prompt, no template hints")

    yield {"type": "step", "label": "SQL"}
    full_text = ""
    async for chunk in llm.complete_stream(system_prompt, messages, {"backend": backend, "label": "stage3", "log_id": msg_id, "user": user, "conversation_id": conversation_id}):
        if isinstance(chunk, dict):
            if chunk.get("type"):
                yield chunk
            continue
        full_text += chunk
        print(chunk, end="", flush=True)
        yield {"type": "token", "text": chunk}
    print()

    sqls_raw = extract_sqls(full_text)

    if not sqls_raw:
        suggestions = []
        sugg_match = re.search(r"<!--suggestions\s*(.*?)\s*-->", full_text, re.DOTALL)
        if sugg_match:
            suggestions = [line.strip() for line in sugg_match.group(1).splitlines() if line.strip()]
        display_text = re.sub(r"\s*<!--suggestions.*?-->", "", full_text, flags=re.DOTALL).strip()
        yield {"type": "text", "text": display_text}
        if suggestions:
            yield {"type": "suggestions", "items": suggestions}
        return

    explanation = re.sub(r"```sql.*?```", "", full_text, flags=re.DOTALL).strip()

    # try each sql alternative until one returns rows
    data = None
    for i, sql_raw in enumerate(sqls_raw):
        sql = postprocess_sql(sql_raw)
        print(f"[stage3] sql[{i}] executing")
        yield {"type": "sql", "sql": sql, "plot_config": None, "explanation": explanation}
        try:
            result = await execute_query(sql)
            if len(result["rows"]) > 0:
                print(f"[stage3] sql[{i}] returned {len(result['rows'])} rows")
                data = result
                break
            else:
                print(f"[stage3] sql[{i}] returned 0 rows")
        except Exception as e:
            print(f"[stage3] sql[{i}] error: {e}")
            yield {"type": "error", "error": f"SQL error: {e}"}

    if data is None:
        print(f"[stage3] no data from any sql")
        return

    yield {"type": "rows", "columns": data["columns"], "rows": data["rows"]}

    yield {"type": "step", "label": "Plot & Summary"}
    plot_config = None
    summary = None
    try:
        plot_config, summary, plot_debug = await generate_plot_and_summary({"user_prompt": prompt, "columns": data["columns"], "rows": data["rows"], "backend": backend, "label": "stage3-plot", "log_id": msg_id, "user": user, "conversation_id": conversation_id})
        yield {"type": "prompt", "text": plot_debug["prompt"]}
        yield {"type": "messages", "messages": plot_debug["messages"]}
        yield {"type": "response", "text": plot_debug["response"]}
        if plot_config:
            yield {"type": "plot_config", "plot_config": plot_config}
        if summary:
            yield {"type": "summary", "text": summary}
    except Exception as e:
        print(f"[stage3] plot+summary error: {e}")

    evaldb.update_result_data(msg_id, {"columns": data["columns"], "rows": data["rows"], "plot_config": plot_config, "summary": summary})
