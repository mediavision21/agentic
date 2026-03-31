import os
import glob
import yaml
import llm_claude


TEMPLATE_DIR = os.path.join(os.path.dirname(__file__), "template")

_cache = None


def load_templates():
    global _cache
    if _cache is not None:
        return _cache
    templates = {}
    for path in glob.glob(os.path.join(TEMPLATE_DIR, "*.yaml")):
        fname = os.path.basename(path)
        with open(path) as f:
            data = yaml.safe_load(f)
        templates[fname] = data
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
        resp = await llm_claude.complete_fast(MATCH_SYSTEM_PROMPT, messages)
        answer = resp.content[0].text.strip()
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
