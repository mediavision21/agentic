import os
import glob
import json
import yaml
import llm
import evaldb
from db import execute_query
from template_filters import detect_placeholders, load_filter_choices, apply_filters, FILTER_REGISTRY

TEMPLATE_DIR = os.path.join(os.path.dirname(__file__), "template")

_cache = None


def load_templates():
    global _cache
    if _cache is not None:
        return _cache
    templates = {}
    for path in glob.glob(os.path.join(TEMPLATE_DIR, "**", "*.yaml"), recursive=True):
        rel = os.path.relpath(path, TEMPLATE_DIR)  # e.g. "viewing-overview/foo.yaml" or "foo.yaml"
        with open(path) as f:
            data = yaml.safe_load(f)
        folder = os.path.dirname(rel)
        if folder:
            data["category"] = folder  # folder name overrides yaml category
        templates[rel] = data
    _cache = templates
    print(f"[template_router] loaded {len(templates)} templates: {list(templates.keys())}")
    return templates


def reload_templates():
    global _cache
    _cache = None
    return load_templates()


MATCH_SYSTEM_PROMPT = """You are a query router. Given a user question and a list of template descriptions, return the top 6 best matching templates with a similarity score from 0.0 to 1.0.

Format (one per line):
filename.yaml: 0.92
filename.yaml: 0.75
filename.yaml: 0.61

If no template is relevant at all, return NONE.
Return only the lines above, nothing else."""


async def match_top_templates(prompt, templates):
    # returns list of {"file": str, "score": float} sorted by score desc, or []
    lines = []
    for fname, data in templates.items():
        desc = data.get("description", fname)
        lines.append(f"- {fname}: {desc}")
    template_list = "\n".join(lines)

    messages = [{"role": "user", "content": f"Templates:\n{template_list}\n\nUser question: {prompt}"}]
    try:
        answer = await llm.complete_fast(MATCH_SYSTEM_PROMPT, messages)
        print(f"[template_router] match result:\n{answer}")
        if answer == "NONE":
            return []
        results = []
        for line in answer.splitlines():
            line = line.strip()
            if not line:
                continue
            parts = line.rsplit(":", 1)
            if len(parts) != 2:
                continue
            fname = parts[0].strip()
            try:
                score = float(parts[1].strip())
            except ValueError:
                continue
            if fname in templates:
                results.append({"file": fname, "score": score})
        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:6]
    except Exception as e:
        print(f"[template_router] match error: {e}")
        return []


FILTER_RESOLVE_PROMPT = """You are given a user message and a list of SQL template filter placeholders with their available choices.
Extract any filter values the user mentioned and return JSON only:
{"resolved": {"country_label": ["Denmark"], "year": ["2024"]}, "missing": ["quarter_label"]}
- "resolved": filters the user specified (use exact values from the choices list, case-insensitive match)
- "missing": filters the user did not mention
If the user did not specify ANY filter values at all, output exactly: NONE
Output nothing except the JSON or NONE."""


async def _resolve_filters(prompt, placeholders, choices_map):
    lines = [f"User message: {prompt}", "", "Filter placeholders:"]
    for name in placeholders:
        choices = choices_map.get(name, [])
        spec = FILTER_REGISTRY.get(name, {})
        label = spec.get("label", name)
        lines.append(f"- {name} ({label}): {', '.join(str(c) for c in choices)}")
    user_msg = "\n".join(lines)
    try:
        text = await llm.complete_fast(FILTER_RESOLVE_PROMPT, [{"role": "user", "content": user_msg}])
        print(f"[template_router] filter resolve: {text}")
        if text == "NONE":
            return None
        data = json.loads(text)
        return data.get("resolved", {}), data.get("missing", [])
    except Exception as e:
        print(f"[template_router] filter resolve error: {e}")
        return None


async def run_matched_template(options):
    prompt = options["prompt"]
    match = options["match"]
    template = options["template"]
    backend = options["backend"]
    msg_id = options["msg_id"]
    user = options["user"]
    conversation_id = options["conversation_id"]
    generate_summary = options["generate_summary"]

    matched_file = match["file"]
    sql = template["sql"].strip()
    description = template.get("description", matched_file)
    print(f"[template_router] running full match: {matched_file} score={match['score']}")

    placeholders = detect_placeholders(sql)
    if placeholders:
        print(f"[template_router] placeholders: {placeholders}")
        yaml_filters = template.get("filters")
        choices_map = await load_filter_choices(placeholders, yaml_filters)
        result = await _resolve_filters(prompt, placeholders, choices_map)
        if result is None:
            lines = ["To show this chart, please specify the filters:"]
            suggestions = []
            for name in placeholders:
                if name not in FILTER_REGISTRY:
                    print(f"[template_router] ERROR: SQL placeholder '{name}' not found in FILTER_REGISTRY")
                    continue
                spec = FILTER_REGISTRY[name]
                label = spec.get("label", name)
                choices = choices_map.get(name, [])
                lines.append(f"- **{label}**: {', '.join(str(c) for c in choices)}")
                suggestions.extend([str(c) for c in choices[:4]])
            yield {"type": "text", "text": "\n".join(lines)}
            yield {"type": "suggestions", "items": suggestions}
            return
        resolved, _missing = result
        sql = apply_filters(sql, resolved)
        print(f"[template_router] filters applied: {resolved}")

    yield {"type": "sql", "sql": sql, "plot_config": None, "explanation": description}

    try:
        data = await execute_query(sql)
        yield {"type": "rows", "columns": data["columns"], "rows": data["rows"]}
    except Exception as e:
        print(f"[template_router] query error: {e}")
        yield {"type": "error", "error": f"SQL error: {e}"}
        evaldb.save_log(
            msg_id, prompt, f"[template] {matched_file}", [], sql,
            "template", {}, user=user, conversation_id=conversation_id
        )
        return

    if template.get("plots"):
        yield {"type": "template_plots", "plots": template["plots"]}

    try:
        summary = await generate_summary(prompt, data["columns"], data["rows"], backend)
        yield {"type": "summary", "text": summary}
    except Exception as e:
        print(f"[template_router] summary error: {e}")

    evaldb.save_log(
        msg_id, prompt, f"[template] {matched_file}", [], sql,
        "template", {}, user=user, conversation_id=conversation_id,
        result_data={"columns": data["columns"], "rows": data["rows"], "plot_config": None}
    )
