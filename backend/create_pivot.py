import asyncio, os, asyncpg
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

GRAIN = [
    "country", "year", "quarter", "month", "period_key",
    "service_id", "service_package_id", "age_group",
    "population_segment", "kpi_detail"
]

async def main():
    url = os.getenv("DATABASE_URL")
    conn = await asyncpg.connect(url)

    rows = await conn.fetch(
        "SELECT DISTINCT category, kpi_type, kpi_dimension "
        "FROM macro.nordic_long_v2 ORDER BY 1, 2, 3"
    )
    print(f"[pivot] {len(rows)} distinct (category, kpi_type, kpi_dimension) combinations")

    cases = []
    for r in rows:
        cat, ktype, kdim = r["category"], r["kpi_type"], r["kpi_dimension"] or ""
        col = f"{cat}_{ktype}" + (f"_{kdim}" if kdim else "")
        expr = (
            f"  MAX(CASE WHEN category='{cat}' AND kpi_type='{ktype}'"
            + (f" AND kpi_dimension='{kdim}'" if kdim else " AND (kpi_dimension IS NULL OR kpi_dimension='')")
            + f" THEN value END) AS {col}"
        )
        cases.append(expr)

    grain_sql = ",\n  ".join(GRAIN)
    cases_sql = ",\n".join(cases)
    sql = (
        f"CREATE OR REPLACE VIEW macro.nordic_wide_v2 AS\n"
        f"SELECT\n  {grain_sql},\n{cases_sql}\n"
        f"FROM macro.nordic_long_v2\n"
        f"GROUP BY {', '.join(GRAIN)};"
    )

    print(sql[:500], "...")
    await conn.execute(f"SET search_path TO macro, public; {sql}")
    print("View created: macro.nordic_wide_v2")
    await conn.close()

if __name__ == "__main__":
    asyncio.run(main())
