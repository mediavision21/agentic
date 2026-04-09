import re
from db import query_single_column

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
    "country_label": {
        "label": "Country",
        "multiple": True,
        "dynamic_sql": "SELECT DISTINCT country_label FROM macro.nordic ORDER BY country_label",
        "default": ["Denmark", "Finland", "Sweden", "Norway"],
    },
    "year": {
        "label": "Year",
        "multiple": True,
        "dynamic_sql": "SELECT DISTINCT year FROM macro.nordic ORDER BY year DESC LIMIT 6",
        "default": [2021, 2022, 2023, 2024, 2025, 2026],
    },
    "service": {
        "label": "Service",
        "multiple": True,
        "dynamic_sql": "SELECT DISTINCT canonical_name FROM macro.nordic WHERE canonical_name IS NOT NULL ORDER BY canonical_name",
    },
    "currency_code": {
        "label": "Currency",
        "multiple": False,
        "default": ["DKK", "EUR", "NOK", "SEK"],
        "dynamic_sql": "SELECT DISTINCT currency_code FROM macro.fact_fx_rate_quarterly ORDER BY currency_code",
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
                result[name] = await query_single_column(spec["dynamic_sql"])
            except Exception as e:
                print(f"[template_filters] failed to load choices for {name}: {e}")
                result[name] = []
    return result


def apply_filters(sql, resolved):
    # resolved: {name: [values]} — values already validated/quoted
    # For each [[ AND {{name}} ]]:
    #   - if name in resolved with values: replace with AND n.name IN ('v1','v2')
    #   - otherwise: remove the block
    # All templates use macro.nordic aliased as n, so columns are prefixed n.
    # Exception: columns not on macro.nordic (e.g. currency_code on fact_fx_rate_quarterly)
    NORDIC_COLUMNS = {
        'country', 'year', 'quarter', 'quarter_label', 'period_label',
        'period_sort', 'category', 'kpi_type', 'kpi_dimension', 'kpi_detail',
        'age_group', 'population_segment', 'canonical_name',
    }

    def replace_block(m):
        full = m.group(0)
        name_match = re.search(r"\{\{(\w+)\}\}", full)
        if name_match is None:
            return ""
        name = name_match.group(1)
        values = resolved.get(name)
        if values:
            quoted = ", ".join(f"'{v}'" for v in values)
            col = f"n.{name}" if name in NORDIC_COLUMNS else name
            return f"AND {col} IN ({quoted})"
        return ""

    result = re.sub(r"\[\[.*?\]\]", replace_block, sql, flags=re.DOTALL)
    return result
