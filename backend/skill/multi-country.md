## Multi-country querying rules

### Quarter filter
When querying more than one country, always filter to Q1 and Q3. Including Q2/Q4 gives Sweden twice as many data points, producing misleading comparisons:
```sql
AND quarter IN (1, 3)  -- always add when querying more than one country
```
Sweden-only queries: all quarters available, no filter needed.

### Population weighting
When combining data from more than one country, always use population-weighted averages. A simple average across countries is incorrect because countries have different population sizes.
- reach, viewing_time — weight by individuals aged 15–74
- penetration, spend, churn_intention, stacking, account_sharing — weight by households aged 15–74

Population data is in `macro.fact_population`. Join on country + year (annual figures apply to all quarters in the same year).
```sql
SUM(value * population) / SUM(population) AS value_weighted
```
Single-country queries: no weighting needed — use AVG(value) with GROUP BY.

### Latest period per country
**Never use a global MAX(period_date) across countries** — Sweden's Q4 will shadow other countries that only have Q3.

When querying the "latest available" data per country, always get the max per country:
```sql
WITH latest AS (
    SELECT country, MAX(period_date) AS period_date
    FROM macro.nordic
    WHERE kpi_type = '<kpi_type>'
    GROUP BY country
)
SELECT n.country, n.period_date, ROUND(AVG(n.value) * 100) AS value
FROM macro.nordic n
JOIN latest l USING (country, period_date)
WHERE n.kpi_type = '<kpi_type>'
  AND n.kpi_dimension = '<dim>'
GROUP BY n.country, n.period_date
ORDER BY n.country
```

For time series across all countries: just SELECT all periods — the chart will naturally align each country to its own available quarters. Do NOT filter to a single MAX period.
