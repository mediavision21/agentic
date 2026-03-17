import os
from db import get_tables, get_columns, get_sample_rows


SKILLS_DIR = os.path.join(os.path.dirname(__file__), "..", "skills")


async def generate_skills():
    os.makedirs(SKILLS_DIR, exist_ok=True)

    tables = await get_tables()
    print(f"[skills] found {len(tables)} tables")

    # overview file
    overview_lines = ["# Database Overview\n"]
    for t in tables:
        cols = await get_columns(t)
        overview_lines.append(f"- **{t}** ({len(cols)} columns)")
    overview_path = os.path.join(SKILLS_DIR, "_overview.md")
    with open(overview_path, "w") as f:
        f.write("\n".join(overview_lines) + "\n")

    # per-table skill files
    for t in tables:
        cols = await get_columns(t)
        col_names, sample_data = await get_sample_rows(t, 3)
        lines = [f"# Table: {t}\n"]

        # columns section
        lines.append("## Columns")
        # compute column widths for aligned markdown table
        headers = ["Name", "Type", "Nullable"]
        col_widths = [len(h) for h in headers]
        col_rows = []
        for c in cols:
            row = [c["name"], c["type"], c["nullable"]]
            col_rows.append(row)
            for i, val in enumerate(row):
                col_widths[i] = max(col_widths[i], len(val))

        header_line = "| " + " | ".join(h.ljust(col_widths[i]) for i, h in enumerate(headers)) + " |"
        sep_line = "| " + " | ".join("-" * col_widths[i] for i in range(len(headers))) + " |"
        lines.append(header_line)
        lines.append(sep_line)
        for row in col_rows:
            lines.append("| " + " | ".join(row[i].ljust(col_widths[i]) for i in range(len(row))) + " |")

        # sample data section
        if sample_data:
            lines.append("")
            lines.append("## Sample Data (3 rows)")
            # compute widths for sample table
            s_widths = {name: len(name) for name in col_names}
            for row in sample_data:
                for name in col_names:
                    s_widths[name] = max(s_widths[name], len(str(row.get(name, ""))))

            header_line = "| " + " | ".join(name.ljust(s_widths[name]) for name in col_names) + " |"
            sep_line = "| " + " | ".join("-" * s_widths[name] for name in col_names) + " |"
            lines.append(header_line)
            lines.append(sep_line)
            for row in sample_data:
                lines.append("| " + " | ".join(str(row.get(name, "")).ljust(s_widths[name]) for name in col_names) + " |")

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
        if fname != "_overview.md":
            tables.append(fname.replace(".md", ""))
    return {"tables": tables, "files": files}
