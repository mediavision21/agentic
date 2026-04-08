import re
from db import execute_query

# Central registry of all known template filter placeholders.
# "choices": static list
# "dynamic_sql": query to fetch choices at runtime
FILTER_REGISTRY = {
    "country": {
        "label": "Country",
        "multiple": True,
        "choices": ["denmark", "finland", "sweden", "norway"],
        "default": ["denmark", "finland", "sweden", "norway"],  # all countries
    },
    "quarter_label": {
        "label": "Quarter",
        "multiple": True,
        "choices": ["Q1", "Q2", "Q3", "Q4"],
        "default": ["Q1", "Q3"],  # odd quarters (standard reporting periods)
    },
    "period_label": {
        "label": "Quarter",
        "multiple": True,
        "choices": ["Q1", "Q2", "Q3", "Q4"],
        "default": ["Q1", "Q3"],  # odd quarters (standard reporting periods)
    },
    "year": {
        "label": "Year",
        "multiple": True,
        "dynamic_sql": "SELECT DISTINCT year::text FROM macro.dim_period ORDER BY year::int DESC",
        "default": [2021, 2022, 2023, 2024, 2025],
    },
}


def _merge_spec(name, yaml_filters):
    # Merge global registry spec with optional per-YAML override
    # yaml_filters: dict from template's "filters" key, e.g. {"quarter_label": {"choices": ["Q1"], "default": ["Q1"]}}
    spec = dict(FILTER_REGISTRY.get(name, {}))
    if yaml_filters and name in yaml_filters:
        spec.update(yaml_filters[name])
    return spec


async def build_default_filters(names, yaml_filters=None):
    # Returns {name: [default values]} for use in direct template execution
    result = {}
    for name in names:
        spec = _merge_spec(name, yaml_filters)
        if not spec:
            continue
        if "default" in spec:
            result[name] = spec["default"]
    return result


def detect_placeholders(sql):
    # Returns list of placeholder names found in [[ AND {{name}} ]] blocks
    return re.findall(r"\[\[.*?\{\{(\w+)\}\}.*?\]\]", sql)


async def load_filter_choices(names, yaml_filters=None):
    # Returns {name: [choices]} resolving dynamic_sql when needed
    result = {}
    for name in names:
        spec = _merge_spec(name, yaml_filters)
        if not spec:
            continue
        if "choices" in spec:
            result[name] = spec["choices"]
        elif "dynamic_sql" in spec:
            try:
                data = await execute_query(spec["dynamic_sql"])
                result[name] = [row[0] for row in data["rows"]]
            except Exception as e:
                print(f"[template_filters] failed to load choices for {name}: {e}")
                result[name] = []
    return result


def apply_filters(sql, resolved):
    # resolved: {name: [values]} — values already validated/quoted
    # For each [[ AND {{name}} ]]:
    #   - if name in resolved with values: replace with AND name IN ('v1','v2')
    #   - otherwise: remove the block
    def replace_block(m):
        full = m.group(0)
        name_match = re.search(r"\{\{(\w+)\}\}", full)
        if name_match is None:
            return ""
        name = name_match.group(1)
        values = resolved.get(name)
        if values:
            quoted = ", ".join(f"'{v}'" for v in values)
            return f"AND n.{name} IN ({quoted})"
        return ""

    result = re.sub(r"\[\[.*?\]\]", replace_block, sql, flags=re.DOTALL)
    return result
