## Daily reach of online video

SELECT
    n.period_date,
    CASE n.kpi_dimension
        WHEN 'social'                THEN 'Social video'
        WHEN 'online_excluding_social' THEN 'Other online'
        WHEN 'online_total'          THEN 'Total online'
    END AS reach_type,
    SUM(n.value * p.value) / SUM(p.value) AS reach_weighted
FROM macro.nordic n
JOIN macro.fact_population p
  ON n.country = p.country
 AND n.year::text = p.year::text
 AND p.population_type = 'individuals'
 AND p.age = '15-74'
WHERE
    n.category = 'online_video'
    AND n.kpi_type = 'reach'
    AND n.kpi_dimension IN ('social', 'online_excluding_social', 'online_total')
    AND (n.service_id IS NULL OR n.service_id = '')
    AND (n.age_group IS NULL OR n.age_group = '')
    AND n.period_date >= '2024-07-01'
    [[ AND {{country_label}} ]]
    [[ AND {{year}} ]]
    [[ AND {{quarter_label}} ]]
    [[ AND {{period_label}} ]]
GROUP BY n.period_date, n.kpi_dimension
ORDER BY
    n.period_date,
    CASE n.kpi_dimension
        WHEN 'social'                THEN 1
        WHEN 'online_excluding_social' THEN 2
        WHEN 'online_total'          THEN 3
    END;


## Daily viewing minutes of online video

SELECT
    r.period_date,
    CASE r.kpi_dimension
        WHEN 'social'                THEN 'Social video'
        WHEN 'online_excluding_social' THEN 'Other online video'
    END AS business_model,
    SUM(r.value * vt.value * p.value) / SUM(p.value) AS viewing_time_population
FROM macro.nordic r
JOIN macro.nordic vt
  ON r.country       = vt.country
 AND r.period_date   = vt.period_date
 AND r.kpi_dimension = vt.kpi_dimension
 AND vt.category          = 'online_video'
 AND vt.kpi_type          = 'viewing_time'
 AND vt.population_segment = 'viewers'
 AND (vt.service_id IS NULL OR vt.service_id = '')
 AND (vt.age_group  IS NULL OR vt.age_group  = '')
JOIN macro.fact_population p
  ON r.country   = p.country
 AND r.year::text = p.year::text
 AND p.population_type = 'individuals'
 AND p.age = '15-74'
WHERE
    r.category = 'online_video'
    AND r.kpi_type = 'reach'
    AND r.kpi_dimension IN ('social', 'online_excluding_social')
    AND (r.service_id IS NULL OR r.service_id = '')
    AND (r.age_group  IS NULL OR r.age_group  = '')
    AND r.period_date >= '2024-07-01'
    [[ AND {{country_label}} ]]
    [[ AND {{year}} ]]
    [[ AND {{quarter_label}} ]]
    [[ AND {{period_label}} ]]
GROUP BY r.period_date, r.kpi_dimension
ORDER BY
    r.period_date,
    CASE r.kpi_dimension
        WHEN 'social'                THEN 1
        WHEN 'online_excluding_social' THEN 2
    END;


## Daily reach of online video per service

SELECT
    n.period_date,
    n.year,
    s.canonical_name AS service,
    SUM(n.value * p.value) / SUM(p.value) AS reach_population
FROM macro.nordic n
JOIN macro.dim_service s
  ON n.service_id = s.service_id
 AND (s.is_streaming_service OR s.is_avod OR s.is_fast OR s.is_public_service)
JOIN macro.fact_population p
  ON n.country    = p.country
 AND n.year::text = p.year::text
 AND p.population_type = 'individuals'
 AND p.age = '15-74'
WHERE
    n.category = 'online_video'
    AND n.kpi_type = 'reach_service'
    AND (n.kpi_dimension IS NULL OR n.kpi_dimension = '')
    AND (n.age_group     IS NULL OR n.age_group     = '')
    AND n.period_date >= '2013-07-01'
    [[ AND {{service}} ]]
    [[ AND {{country_label}} ]]
    [[ AND {{year}} ]]
    [[ AND {{quarter_label}} ]]
    [[ AND {{period_label}} ]]
GROUP BY n.period_date, n.year, s.canonical_name
ORDER BY n.period_date, reach_population DESC;


## Daily reach of social video per service

SELECT
    n.period_date,
    n.year,
    s.canonical_name AS service,
    SUM(n.value * p.value) / SUM(p.value) AS reach_population
FROM macro.nordic n
JOIN macro.dim_service s
  ON n.service_id      = s.service_id
 AND s.is_social_video = TRUE
JOIN macro.fact_population p
  ON n.country    = p.country
 AND n.year::text = p.year::text
 AND p.population_type = 'individuals'
 AND p.age = '15-74'
WHERE
    n.category = 'online_video'
    AND n.kpi_type = 'reach_service'
    AND (n.kpi_dimension IS NULL OR n.kpi_dimension = '')
    AND (n.age_group     IS NULL OR n.age_group     = '')
    AND n.period_date >= '2020-01-01'
    [[ AND {{country_label}} ]]
    [[ AND {{year}} ]]
    [[ AND {{quarter_label}} ]]
    [[ AND {{period_label}} ]]
GROUP BY n.period_date, n.year, s.canonical_name
ORDER BY n.period_date, reach_population DESC;


## Share of online video viewing by service¹

-- Two-pass aggregation required: within-country shares first, then country-weighted average
WITH country_service AS (
    SELECT
        r.period_date,
        r.country,
        s.canonical_name                          AS service,
        SUM(r.value * vt.value)                   AS viewing_time_individual,
        MAX(p.value)                              AS population_15_74
    FROM macro.nordic r
    JOIN macro.nordic vt
      ON r.country      = vt.country
     AND r.period_date  = vt.period_date
     AND r.service_id   = vt.service_id
     AND vt.category          = 'online_video'
     AND vt.kpi_type          = 'viewing_time_service'
     AND vt.population_segment = 'viewers'
     AND (vt.kpi_dimension IS NULL OR vt.kpi_dimension = '')
     AND (vt.age_group    IS NULL OR vt.age_group    = '')
    JOIN macro.dim_service s
      ON r.service_id = s.service_id
     AND (s.is_streaming_service OR s.is_avod OR s.is_fast OR s.is_public_service)
    JOIN macro.fact_population p
      ON r.country    = p.country
     AND r.year::text = p.year::text
     AND p.population_type = 'individuals'
     AND p.age = '15-74'
    WHERE
        r.category = 'online_video'
        AND r.kpi_type = 'reach_service'
        AND (r.kpi_dimension IS NULL OR r.kpi_dimension = '')
        AND (r.age_group     IS NULL OR r.age_group     = '')
        AND r.period_date >= '2024-07-01'
        [[ AND {{country_label}} ]]
        [[ AND {{year}} ]]
        [[ AND {{quarter_label}} ]]
        [[ AND {{period_label}} ]]
    GROUP BY r.period_date, r.country, r.service_id, s.canonical_name
)
SELECT
    period_date,
    service,
    SUM(
        (viewing_time_individual / NULLIF(SUM(viewing_time_individual) OVER (PARTITION BY period_date, country), 0))
        * (population_15_74      / NULLIF(SUM(population_15_74)        OVER (PARTITION BY period_date),         0))
    ) AS share_of_total
FROM country_service
GROUP BY period_date, service
ORDER BY period_date, share_of_total DESC;


## Share of social video viewing by service²

-- Two-pass aggregation required: within-country shares first, then country-weighted average
WITH country_service AS (
    SELECT
        r.period_date,
        r.country,
        s.canonical_name                          AS service,
        SUM(r.value * vt.value)                   AS viewing_time_individual,
        MAX(p.value)                              AS population_15_74
    FROM macro.nordic r
    JOIN macro.nordic vt
      ON r.country      = vt.country
     AND r.period_date  = vt.period_date
     AND r.service_id   = vt.service_id
     AND vt.category          = 'online_video'
     AND vt.kpi_type          = 'viewing_time_service'
     AND vt.population_segment = 'viewers'
     AND (vt.kpi_dimension IS NULL OR vt.kpi_dimension = '')
     AND (vt.age_group    IS NULL OR vt.age_group    = '')
    JOIN macro.dim_service s
      ON r.service_id      = s.service_id
     AND s.is_social_video = TRUE
    JOIN macro.fact_population p
      ON r.country    = p.country
     AND r.year::text = p.year::text
     AND p.population_type = 'individuals'
     AND p.age = '15-74'
    WHERE
        r.category = 'online_video'
        AND r.kpi_type = 'reach_service'
        AND (r.kpi_dimension IS NULL OR r.kpi_dimension = '')
        AND (r.age_group     IS NULL OR r.age_group     = '')
        AND r.period_date >= '2024-07-01'
        [[ AND {{country_label}} ]]
        [[ AND {{year}} ]]
        [[ AND {{quarter_label}} ]]
        [[ AND {{period_label}} ]]
    GROUP BY r.period_date, r.country, r.service_id, s.canonical_name
)
SELECT
    period_date,
    service,
    SUM(
        (viewing_time_individual / NULLIF(SUM(viewing_time_individual) OVER (PARTITION BY period_date, country), 0))
        * (population_15_74      / NULLIF(SUM(population_15_74)        OVER (PARTITION BY period_date),         0))
    ) AS share_of_total
FROM country_service
GROUP BY period_date, service
ORDER BY period_date, share_of_total DESC;
