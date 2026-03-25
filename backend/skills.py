import os
import re


SKILLS_DIR = os.path.join(os.path.dirname(__file__), "..", "skills")
SKILL_SRC_DIR = os.path.join(os.path.dirname(__file__), "skill")
ENTRY_FILE = "SKILL.md"


def _resolve_links(content, files, resolved=None):
    # recursive resolve ## [filename.md] links by inlining referenced file content
    if resolved is None:
        resolved = set()
    def replacer(m):
        fname = m.group(1)
        if fname in resolved:
            return ""  # avoid circular links
        if fname not in files:
            return m.group(0)  # leave unresolved
        resolved.add(fname)
        # resolve nested links in the inlined file too
        return _resolve_links(files[fname].strip(), files, resolved)
    return re.sub(r'##\s*\[([^\]]+\.md)\]:?', replacer, content)


def generate_skills():
    os.makedirs(SKILLS_DIR, exist_ok=True)

    # load all .md files from skill/ folder
    files = {}
    for fname in sorted(os.listdir(SKILL_SRC_DIR)):
        if not fname.endswith(".md"):
            continue
        fpath = os.path.join(SKILL_SRC_DIR, fname)
        with open(fpath, "r") as f:
            files[fname] = f.read()

    entry_path = os.path.join(SKILL_SRC_DIR, ENTRY_FILE)
    if not os.path.exists(entry_path):
        print(f"[skills] warning: no entry file {ENTRY_FILE}")
        return

    with open(entry_path, "r") as f:
        content = f.read()

    content = _resolve_links(content, files)

    skill_path = os.path.join(SKILLS_DIR, ENTRY_FILE)
    with open(skill_path, "w") as f:
        f.write(content)
    print(f"[skills] wrote {skill_path}")


def load_skills():
    files = {}
    tables = []
    if not os.path.exists(SKILLS_DIR):
        return {"tables": [], "files": {}}
    for fname in sorted(os.listdir(SKILLS_DIR)):
        if not fname.endswith(".md"):
            continue
        fpath = os.path.join(SKILLS_DIR, fname)
        with open(fpath, "r") as f:
            files[fname] = f.read()
        tables.append(fname.replace(".md", ""))
    return {"tables": tables, "files": files}
