import uuid
import stage2
import stage3
from template_router import load_templates, match_top_templates, run_matched_template


async def generate_agent_stream(prompt, backend="claude", history=None, user="", conversation_id=""):
    if history is None:
        history = []

    msg_id = str(uuid.uuid4())
    yield {"type": "msg_id", "id": msg_id}

    templates = load_templates()
    matches = await match_top_templates(prompt, templates) if templates else []

    # stage 1: direct template execution on high-confidence match
    if matches and matches[0]["score"] >= 0.95:
        async for event in run_matched_template({
            "prompt": prompt,
            "match": matches[0],
            "template": templates[matches[0]["file"]],
            "backend": backend,
            "msg_id": msg_id,
            "user": user,
            "conversation_id": conversation_id,
            "generate_summary": stage2.generate_summary,
        }):
            yield event
        return

    # stage 2: template-guided LLM generation (2 tries × 3 templates)
    if matches:
        stage2_found_data = False
        async for event in stage2.run({
            "prompt": prompt,
            "matches": matches,
            "templates": templates,
            "backend": backend,
            "history": history,
            "msg_id": msg_id,
            "user": user,
            "conversation_id": conversation_id,
        }):
            if event.get("type") == "__stage2_no_data__":
                break
            yield event
            if event.get("type") == "rows" and len(event.get("rows", [])) > 0:
                stage2_found_data = True
        if stage2_found_data:
            return

    # stage 3: full schema/skills prompt, no template hints
    async for event in stage3.run({
        "prompt": prompt,
        "backend": backend,
        "history": history,
        "msg_id": msg_id,
        "user": user,
        "conversation_id": conversation_id,
    }):
        yield event
