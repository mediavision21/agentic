import os
from db import get_columns, get_column_stats, get_kpi_type_dimensions, schema as DB_SCHEMA


SKILLS_DIR = os.path.join(os.path.dirname(__file__), "..", "skills")
TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "skill_templates")

# Define which tables/views to generate skills for
SKILL_TABLES = ['nordic']
THRESHOLD = 100


async def generate_skills():
    os.makedirs(SKILLS_DIR, exist_ok=True)
    print(f"[skills] generating for {len(SKILL_TABLES)} tables")

    for t in SKILL_TABLES:
        cols = await get_columns(t)
        col_names = {c["name"] for c in cols}
        lines = [f"# {DB_SCHEMA}.{t}", "", "columns:"]

        for c in cols:
            stats = await get_column_stats(t, c["name"], c["type"], THRESHOLD)
            lines.append(f"{c['name']},{c['type']},{stats}")

        # valid kpi combinations — only if table has kpi_type + kpi_dimension
        if "kpi_type" in col_names and "kpi_dimension" in col_names:
            combos = await get_kpi_type_dimensions(t)
            if combos:
                lines.append("")
                lines.append("# valid kpi combinations (kpi_type: kpi_dimensions)")
                for kt, dims in combos.items():
                    dim_str = ",".join(d if d else "''" for d in dims)
                    lines.append(f"{kt}: {dim_str}")

        # append template notes if file exists
        template_path = os.path.join(TEMPLATES_DIR, f"{t}.md")
        if os.path.exists(template_path):
            with open(template_path, "r") as f:
                template = f.read().strip()
            lines.append("")
            lines.append(template)

        skill_path = os.path.join(SKILLS_DIR, f"{t}.md")
        with open(skill_path, "w") as f:
            f.write("\n".join(lines) + "\n")
        print(f"[skills] wrote {skill_path}")


def load_skills():
    # returns {tables: [...], files: {name: content}}
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
