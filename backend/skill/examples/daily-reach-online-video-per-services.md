## prompts

- What is the reach fo streaming services? 
- What are the most viewed streaming services? 
- Rank the most commonly used streaming services and social media platforms

## SQL
```sql
WITH
    population AS (
      SELECT
        country,
        YEAR::TEXT AS YEAR,
        VALUE AS population_15_74
      FROM
        macro.fact_population
      WHERE
        population_type = 'individuals'
        AND age = '15-74'
    ),
    reach AS (
      SELECT
        country,
        YEAR,
        quarter,
        service_id,
        VALUE AS reach_service
      FROM
        macro.nordic_long_v2
      WHERE
        category = 'online_video'
        AND kpi_type = 'reach_service'
        AND (kpi_dimension IS NULL OR kpi_dimension = '')
        AND (age_group IS NULL OR age_group = '')
        AND (service_package_id IS NULL OR service_package_id = '')
    ),
    base AS (
      SELECT
        p.period_sort,
        p.period_label,
        p.year,
        p.quarter_label,
        s.canonical_name AS service,
        r.service_id,
        r.country,
        r.reach_service,
        pop.population_15_74
      FROM
        reach r
        JOIN macro.dim_period p ON r.year = p.year AND r.quarter = p.quarter
        JOIN macro.dim_service s ON r.service_id = s.service_id
          AND (s.is_streaming_service OR s.is_avod OR s.is_fast OR s.is_public_service)
        JOIN population pop ON r.country = pop.country AND r.year = pop.year
        JOIN macro.dim_country c ON r.country = c.country
      WHERE
        p.period_sort >= 20133
        AND s.canonical_name IN ('YouTube', 'Netflix', 'Disney+', 'HBO Max', 'Viaplay', 'Prime Video')
        AND p.period_sort IN (20243, 20253)
    ),
    reach_weighted AS (
      SELECT
        period_sort,
        period_label,
        YEAR,
        quarter_label,
        service,
        service_id,
        SUM(reach_service * population_15_74) / SUM(population_15_74) AS reach_population
      FROM
        base
      GROUP BY
        period_sort, period_label, YEAR, quarter_label, service, service_id
    ),
    latest_period AS (
      SELECT MAX(period_sort) AS max_period_sort
      FROM reach_weighted
    ),
    service_rank AS (
      SELECT
        service,
        ROW_NUMBER() OVER (ORDER BY reach_population DESC) AS service_rank
      FROM reach_weighted
      WHERE period_sort = (SELECT max_period_sort FROM latest_period)
    ),
    final AS (
      SELECT
        r.period_sort, r.period_label, r.year, r.quarter_label,
        r.service, r.reach_population, sr.service_rank
      FROM reach_weighted r
      JOIN service_rank sr ON r.service = sr.service
    )
  SELECT
    period_sort, period_label, YEAR, quarter_label,
    service, reach_population
  FROM final
  ORDER BY service_rank ASC, period_sort;
```

## plot

```
Plot.plot({
  marginLeft: 60,
  marginBottom: 50,
  width: 800,
  height: 400,
  x: {
    type: "band",
    padding: 0.2,
    label: null,
    domain: ["Netflix", "Disney+", "HBO Max", "Viaplay", "Prime Video"]
  },
  y: {
    tickFormat: "%",
    grid: true,
    label: null,
    domain: [0, 0.30]
  },
  color: {
    domain: ["Q3 2024", "Q3 2025"],
    range: ["#1a5c3a", "#2d8653"],  // dark green, lighter green
    legend: true
  },
  marks: [
    Plot.barY(data, {
      x: "Service",
      y: "Value",
      fill: "Period",
      fx: "Service",         // facet by service to group bars side by side
      tip: true
    }),
    Plot.ruleY([0])
  ]
})```