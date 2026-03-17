import os
from db import get_tables, get_columns, get_sample_rows


SKILLS_DIR = os.path.join(os.path.dirname(__file__), "..", "skills")


async def generate_skills():
	os.makedirs(SKILLS_DIR, exist_ok=True)

	tables = await get_tables()
	print(f"[skills] found {len(tables)} tables")

	# overview: table(col_count) col1, col2, ...
	overview_lines = []
	for t in tables:
		cols = await get_columns(t)
		col_names = ", ".join(c["name"] for c in cols)
		overview_lines.append(f"{t}({len(cols)}) {col_names}")
	overview_path = os.path.join(SKILLS_DIR, "_overview.txt")
	with open(overview_path, "w") as f:
		f.write("\n".join(overview_lines) + "\n")

	# per-table skill files
	for t in tables:
		cols = await get_columns(t)
		col_names, sample_data = await get_sample_rows(t, 3)
		lines = [f"# {t}", ""]

		# columns: one per line as name,type,nullable
		for c in cols:
			lines.append(f"{c['name']},{c['type']},{c['nullable']}")

		# sample data as csv rows
		if sample_data:
			lines.append("")
			lines.append("# sample")
			lines.append(",".join(col_names))
			for row in sample_data:
				lines.append(",".join(str(row.get(name, "")) for name in col_names))

		skill_path = os.path.join(SKILLS_DIR, f"{t}.txt")
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
		if not fname.endswith(".txt"):
			continue
		fpath = os.path.join(SKILLS_DIR, fname)
		with open(fpath, "r") as f:
			files[fname] = f.read()
		if fname != "_overview.txt":
			tables.append(fname.replace(".txt", ""))
	return {"tables": tables, "files": files}
