from datetime import datetime
import stage2
import stage3
from plot_config import generate_summary
from template_router import load_templates, match_top_templates, run_matched_template
from intent import extract_intent, is_data_query, resolve_defaults, build_preamble, build_suggestions, build_intent_prompt_block


def make_timestamp_id():
    now = datetime.now()
    return now.strftime("%Y-%m-%d %H:%M:%S") + f".{now.microsecond * 1000:09d}"


async def generate_agent_stream(prompt, backend="claude", history=None, user="", conversation_id=""):
    if history is None:
        history = []

    if not conversation_id:
        conversation_id = make_timestamp_id()
    yield {"type": "conversation_id", "id": conversation_id}

    msg_id = make_timestamp_id()
    yield {"type": "msg_id", "id": msg_id}

    # stage 0: intent resolution — extract + resolve defaults
    partial = extract_intent(prompt)
    intent = None
    intent_block = ""
    if is_data_query(partial):
        intent = resolve_defaults(partial)
        preamble = build_preamble(intent)
        intent_block = build_intent_prompt_block(intent)
        print(f"[intent] resolved: kpi={intent['kpi_type']} dim={intent.get('kpi_dimension')} countries={intent.get('countries')} defaults={intent.get('applied_defaults')}")
        yield {"type": "preamble", "text": preamble}

    templates = load_templates()
    matches = []
    if templates:
        matches, match_debug = await match_top_templates(prompt, templates)

    # stage 1: routing — match user prompt against template descriptions
    if matches:
        yield {"type": "stage", "stage": 1, "label": "Routing"}
        yield {"type": "prompt", "text": match_debug["prompt"]}
        yield {"type": "messages", "messages": match_debug["messages"]}
        yield {"type": "response", "text": match_debug["response"]}
    if matches and matches[0]["score"] >= 0.95:
        yield {"type": "stage", "stage": 2, "label": "Template Execution"}
        distilled = ""
        async for event in run_matched_template({
            "prompt": prompt,
            "match": matches[0],
            "template": templates[matches[0]["file"]],
            "backend": backend,
            "msg_id": msg_id,
            "user": user,
            "conversation_id": conversation_id,
            "generate_summary": generate_summary,
            "intent": intent,
        }):
            if event.get("type") == "summary":
                distilled = event.get("text", "")
            elif event.get("type") == "text" and not distilled:
                distilled = event.get("text", "")[:500]
            yield event
        if intent:
            yield {"type": "suggestions", "items": build_suggestions(intent)}
        if distilled:
            yield {"type": "distilled_summary", "text": distilled}
        return

    # stage 2: guided generation — LLM with template examples (2 tries × 3 templates)
    if matches:
        yield {"type": "stage", "stage": 2, "label": "Guided Generation"}
        stage2_handled = False
        distilled = ""
        async for event in stage2.run({
            "prompt": prompt,
            "matches": matches,
            "templates": templates,
            "backend": backend,
            "history": history,
            "msg_id": msg_id,
            "user": user,
            "conversation_id": conversation_id,
            "intent_block": intent_block,
        }):
            if event.get("type") == "__stage2_no_data__":
                break
            if event.get("type") == "summary":
                distilled = event.get("text", "")
            elif event.get("type") == "text" and not distilled:
                distilled = event.get("text", "")[:500]
            yield event
            # stage2 handled: either found data rows, or gave a conversational reply
            if event.get("type") == "rows" and len(event.get("rows", [])) > 0:
                stage2_handled = True
            if event.get("type") == "text":
                stage2_handled = True
        if stage2_handled:
            if intent:
                yield {"type": "suggestions", "items": build_suggestions(intent)}
            if distilled:
                yield {"type": "distilled_summary", "text": distilled}
            return

    # stage 2: open generation — full schema, no template hints
    yield {"type": "stage", "stage": 2, "label": "Open Generation"}
    distilled = ""
    async for event in stage3.run({
        "prompt": prompt,
        "backend": backend,
        "history": history,
        "msg_id": msg_id,
        "user": user,
        "conversation_id": conversation_id,
        "intent_block": intent_block,
    }):
        if event.get("type") == "summary":
            distilled = event.get("text", "")
        elif event.get("type") == "text" and not distilled:
            distilled = event.get("text", "")[:500]
        yield event
    if intent:
        yield {"type": "suggestions", "items": build_suggestions(intent)}
    if distilled:
        yield {"type": "distilled_summary", "text": distilled}
