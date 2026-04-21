import asyncio
import argparse
import json
import os
import sys
import yaml
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
import env  # noqa: F401
import db
import plot as plot_module
from template_router import load_templates
from template_filters import detect_placeholders, build_default_filters, apply_filters


class _LiteralStr(str):
	pass


class _Dumper(yaml.Dumper):
	pass


def _literal_representer(dumper, data):
	return dumper.represent_scalar('tag:yaml.org,2002:str', data, style='|')


_Dumper.add_representer(_LiteralStr, _literal_representer)


async def get_template_data(sql, yaml_filters):
	names = detect_placeholders(sql)
	resolved = await build_default_filters(names, yaml_filters)
	result = await db.execute_query(apply_filters(sql, resolved))
	return result["columns"], result["rows"]


async def render_svg(plot_config, rows):
	payload = json.dumps({"config": plot_config, "rows": rows[:50]}, default=str)
	script = os.path.join(os.path.dirname(__file__), "../eval/render_plot.mjs")
	proc = await asyncio.create_subprocess_exec(
		"node", script,
		stdin=asyncio.subprocess.PIPE,
		stdout=asyncio.subprocess.PIPE,
		stderr=asyncio.subprocess.PIPE,
	)
	stdout, stderr = await proc.communicate(payload.encode())
	if proc.returncode != 0:
		return None, stderr.decode().strip()
	return stdout.decode(), None


def write_yaml_results(results, versions, out_dir):
	for fname, data in results.items():
		safe_name = fname.replace("/", "_").replace(".yaml", "")
		versions_str = "-".join(versions)
		out_path = out_dir / f"{safe_name}_{versions_str}.yaml"

		data_section = {}
		for v in versions:
			vdata = data.get("versions", {}).get(v)
			if vdata and vdata.get("config"):
				data_section[v] = _LiteralStr(json.dumps(vdata["config"], indent=2))

		record = {
			"name": fname,
			"description": data.get("description", fname),
			"columns": data.get("columns", []),
			"rows": data.get("rows", [])[:50],
			"data": data_section,
		}

		out_path.write_text(yaml.dump(record, Dumper=_Dumper, allow_unicode=True, sort_keys=False))
		print(f"[yaml]   {out_path}")


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--versions", default="v3")
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--template", default=None)
    args = parser.parse_args()
    versions = [v.strip() for v in args.versions.split(",")]

    await db.create_pool()
    templates = load_templates()

    if args.template is not None:
        keys = list(templates.keys())
        if args.template.isdigit():
            idx = int(args.template)
            template_list = [(keys[idx], templates[keys[idx]])] if idx < len(keys) else []
        elif "-" in args.template and args.template.replace("-", "").isdigit():
            start, end = args.template.split("-", 1)
            template_list = [(keys[i], templates[keys[i]]) for i in range(int(start), min(int(end) + 1, len(keys)))]
        else:
            matched = [(k, v) for k, v in templates.items() if args.template in k]
            template_list = matched
    else:
        template_list = list(templates.items())[:args.limit]

    prompt_by_version = {}
    for version in versions:
        yaml_path = os.path.join(os.path.dirname(__file__), f"plot-{version}.yaml")
        with open(yaml_path) as f:
            prompt_by_version[version] = yaml.safe_load(f)

    out_dir = Path("eval-output")
    out_dir.mkdir(parents=True, exist_ok=True)

    # results[fname] = {description, columns, rows, versions: {version: {svg, config}}}
    results = {}

    for fname, tdata in template_list:
        sql = tdata.get("sql")
        if not sql:
            print(f"[skip] {fname} — no sql")
            continue

        try:
            columns, rows = await get_template_data(sql, tdata.get("filters"))
        except Exception as e:
            print(f"[error] {fname} sql: {e}")
            continue

        if not rows:
            print(f"[skip] {fname} — no rows")
            continue

        results[fname] = {
            "description": tdata.get("description", fname),
            "columns": columns,
            "rows": rows,
            "versions": {},
        }

        for version in versions:
            name = fname.replace("/", "_").replace(".yaml", "")

            try:
                plot_config, _, _, _ = await plot_module.generate_plot_and_summary({
                    "user_prompt": tdata.get("description", fname),
                    "columns": columns,
                    "rows": rows,
                    "prompt_data": prompt_by_version[version],
                    "label": f"eval-{version}-{name}",
                })

                if not plot_config:
                    print(f"[fail] {fname} [{version}] — no plot_config from LLM")
                    continue

                svg, err = await render_svg(plot_config, rows)
                if err:
                    print(f"[fail] {fname} [{version}] — {err[:120]}")
                    continue

                results[fname]["versions"][version] = {"svg": svg, "config": plot_config}
                print(f"[ok]   {fname} [{version}]")

            except Exception as e:
                print(f"[error] {fname} [{version}]: {e}")

    await db.close_pool()
    write_yaml_results(results, versions, out_dir)


asyncio.run(main())
