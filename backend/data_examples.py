from db import execute_query

_data_examples_cache = None
_kpi_combinations_cache = None

DATA_EXAMPLES_SQL = """
WITH latest AS (
    SELECT year, quarter
    FROM macro.nordic
    ORDER BY year DESC, quarter DESC
    LIMIT 1
),
ranked AS (
    SELECT
        n.year,
        n.quarter_label,
        n.country,
        n.category,
        COALESCE(n.canonical_name, '') AS service,
        n.kpi_type,
        COALESCE(n.kpi_dimension, '') AS kpi_dimension,
        COALESCE(n.kpi_detail, '') AS kpi_detail,
        n.age_group,
        COALESCE(n.population_segment, '') AS population_segment,
        ROUND(n.value::numeric, 4) AS value,
        ROW_NUMBER() OVER (
            PARTITION BY n.kpi_type, n.country
            ORDER BY n.category, n.canonical_name, n.kpi_dimension
        ) AS rn
    FROM macro.nordic n
    JOIN latest l ON n.year = l.year AND n.quarter = l.quarter
    WHERE n.country IN ('sweden', 'norway')
      AND n.kpi_type IN ('reach', 'viewing_time', 'penetration', 'spend', 'reach_service')
)
SELECT year, quarter_label, country, category, service,
       kpi_type, kpi_dimension, kpi_detail, age_group, population_segment, value
FROM ranked
WHERE rn <= 5
ORDER BY kpi_type, country, rn
"""

KPI_COMBINATIONS_SQL = """
SELECT DISTINCT category, kpi_type, COALESCE(kpi_dimension, '') AS kpi_dimension
FROM macro.nordic
WHERE category IS NOT NULL AND kpi_type IS NOT NULL
ORDER BY category, kpi_type, kpi_dimension
"""

CANONICAL_NAMES_SQL = """
SELECT DISTINCT canonical_name
FROM macro.nordic
WHERE canonical_name IS NOT NULL AND canonical_name != ''
ORDER BY canonical_name
"""


async def load_data_examples():
    global _data_examples_cache
    if _data_examples_cache is not None:
        return _data_examples_cache
    try:
        data = await execute_query(DATA_EXAMPLES_SQL)
        cols = data["columns"]
        lines = [",".join(str(c) for c in cols)]
        for row in data["rows"]:
            lines.append(",".join("" if row[c] is None else str(row[c]) for c in cols))
        _data_examples_cache = "\n".join(lines)
    except Exception as e:
        print(f"[data_examples] load_data_examples error: {e}")
        _data_examples_cache = ""
    return _data_examples_cache


async def load_kpi_combinations():
    global _kpi_combinations_cache
    if _kpi_combinations_cache is not None:
        return _kpi_combinations_cache
    try:
        combos = await execute_query(KPI_COMBINATIONS_SQL)
        names = await execute_query(CANONICAL_NAMES_SQL)

        rows = ["category,kpi_type,kpi_dimension"]
        for row in combos["rows"]:
            rows.append(f"{row['category'] or ''},{row['kpi_type'] or ''},{row['kpi_dimension'] or ''}")

        canonical = [r["canonical_name"] for r in names["rows"]]
        rows.append("")
        rows.append("Valid canonical_names (for service KPIs): " + ", ".join(canonical))

        _kpi_combinations_cache = "\n".join(rows)
    except Exception as e:
        print(f"[data_examples] load_kpi_combinations error: {e}")
        _kpi_combinations_cache = ""
    return _kpi_combinations_cache
