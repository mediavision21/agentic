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


MATCH_SYSTEM_PROMPT = """You are a query router. Given a user question and a list of template descriptions, return ONLY the filename of the best matching template, or NONE if no template matches.
Be generous in matching - if the question is about the same topic as a template, match it.
Reply with just the filename or NONE. Nothing else."""


async def match_template(prompt, templates):
    lines = []
    for fname, data in templates.items():
        desc = data.get("description", fname)
        lines.append(f"- {fname}: {desc}")
    template_list = "\n".join(lines)

    messages = [{"role": "user", "content": f"Templates:\n{template_list}\n\nUser question: {prompt}"}]
    try:
        resp = await llm_claude.complete_fast(MATCH_SYSTEM_PROMPT, messages)
        answer = resp.content[0].text.strip()
        print(f"[template_router] match result: {answer}")
        if answer == "NONE" or answer not in templates:
            return None
        return answer
    except Exception as e:
        print(f"[template_router] match error: {e}")
        return None
