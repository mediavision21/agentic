from agent import postprocess_sql

sql_in = """SELECT
  country,
  period_date,
  ROUND(AVG(value) * 100) AS value
FROM macro.nordic
WHERE kpi_type = 'reach'
  AND category = 'online_video'
  AND kpi_dimension = ''
GROUP BY country, period_date
ORDER BY country, period_date;"""

sql_out = postprocess_sql(sql_in)

print("=== input ===")
for i, line in enumerate(sql_in.splitlines(), 1):
    print(f"  {i:2}  {line}")

print()
print("=== output ===")
for i, line in enumerate(sql_out.splitlines(), 1):
    print(f"  {i:2}  {line}")

print()
# show which lines were removed (compare stripped content to ignore indentation differences)
out_stripped = {l.strip() for l in sql_out.splitlines()}
removed = [l for l in sql_in.splitlines() if l.strip() and l.strip() not in out_stripped]
if removed:
    print("=== removed lines ===")
    for l in removed:
        print(f"  - {l!r}")
else:
    print("(no lines removed)")
