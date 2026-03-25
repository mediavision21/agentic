# How to handle data 
## stacking
- Unit: average number of paid services per subscriber (e.g. 1.85 = holds ~2 services on average)
- Value range: 0–3.15
- category: online_video
- kpi_dimension: svod, ssvod, hvod
- population_segment: subscribers
- countries: all four
- years: 2013–2025

## Duplicate rows and aggregation
nordic contains multiple rows per (country, period_date, kpi_type, kpi_dimension) because:
- age_group creates one row per age bucket + one for the total (empty age_group)
- population_segment splits rows (e.g. viewers vs genre_viewers)
- kpi_detail was dropped from the source table — rows that differed only by kpi_detail now appear identical except for value
- _service kpi_types: service_id was dropped — rows for different services are collapsed

**Rule: always GROUP BY every non-value column in your SELECT, and use AVG(value).**

Example correct pattern:
```sql
SELECT country, period_date, kpi_dimension, AVG(value) AS value
FROM macro.nordic
WHERE kpi_type = 'reach' AND category = 'online_video' AND kpi_dimension = 'svod'
GROUP BY country, period_date, kpi_dimension
ORDER BY country, period_date
```

Special case — reach_monthly spans three categories (cinema, dvd_blu_ray, tvod).
Either filter to one category or include category in GROUP BY:
```sql
SELECT country, period_date, category, AVG(value) AS value
FROM macro.nordic
WHERE kpi_type = 'reach_monthly'
GROUP BY country, period_date, category
ORDER BY country, period_date, category
```

AVG is correct for all kpi_types. Do not use SUM unless explicitly asked for a total count.




## Multi-dimension time series (period_date × country × age_group)
When a query returns period_date as x-axis and has both country and age_group as dimensions, create a composite series label:
```sql
country || ' · ' || COALESCE(NULLIF(age_group, ''), 'All ages') AS series
```
Then use `series` as the stroke column in the plot config. This produces one clearly labelled line per country/age combination.

If only country varies (no age_group breakdown), use `country` as stroke directly.

## Value formatting in SQL
Apply the correct formula in the SELECT clause when computing the value column:

Percentage metrics (ratio × 100, ROUND to 0 decimals — display as whole number like 75 not 0.75):
- reach, reach_weekly, reach_monthly, reach_service, reach_service_weekly → ROUND(AVG(value) * 100) AS value
- penetration, penetration_service → ROUND(AVG(value) * 100) AS value
- churn_intention, churn_intention_service → ROUND(AVG(value) * 100) AS value
- account_sharing → ROUND(AVG(value) * 100) AS value
- gross_access, gross_access_service → ROUND(AVG(value) * 100) AS value

Currency metrics (local currency/month, keep 0 decimals):
- spend, spend_service → ROUND(AVG(value)) AS value

Time metrics (minutes/day, 1 decimal):
- viewing_time, viewing_time_service → ROUND(AVG(value)::numeric, 1) AS value

Count metrics (keep 2 decimals):
- stacking → ROUND(AVG(value)::numeric, 2) AS value