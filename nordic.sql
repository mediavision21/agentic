DROP MATERIALIZED VIEW macro.nordic;

-- CREATE OR REPLACE  VIEW macro.nordic AS
CREATE MATERIALIZED VIEW macro.nordic AS
SELECT
    MAKE_DATE(
        l.year::integer,
        CASE l.quarter WHEN 'q1' THEN 1 WHEN 'q2' THEN 4 WHEN 'q3' THEN 7 WHEN 'q4' THEN 10 END,
        1
    )                                                                       AS period_date,
    CASE l.country
        WHEN 'dk' THEN 'denmark'
        WHEN 'fi' THEN 'finland'
        WHEN 'no' THEN 'norway'
        WHEN 'se' THEN 'sweden'
    END                                                                     AS country,
    NULLIF(TRIM(l.category), '')                                            AS category,
    s.canonical_name                                                        AS canonical_name,
	l.service_id,
    NULLIF(TRIM(REGEXP_REPLACE(l.kpi_type, '_service$', '')), '')           AS kpi_type,
    NULLIF(TRIM(l.kpi_dimension), '')                                       AS kpi_dimension,
    NULLIF(TRIM(l.kpi_detail), '')                                          AS kpi_detail,
    COALESCE(NULLIF(l.age_group, ''), '15-74')                              AS age_group,
    NULLIF(TRIM(l.population_segment), '')                                  AS population_segment,
    l.value,
    -- service classification flags (NULL when no service on the row)
    s.is_social_video,
    s.is_streaming_service,
    s.is_avod,
    s.is_fast,
    s.is_public_service,
    -- age-group-specific population (individuals for this row's age_group)
    pop.value                                                               AS population,
    -- always 15-74 individuals — use for country-weighting across age groups
    ind.value                                                               AS population_1574,
    -- always 15-74 households
    hh.value                                                                AS population_household
FROM macro.nordic_long_v2       l
LEFT JOIN macro.dim_service      s   ON l.service_id = s.service_id
LEFT JOIN macro.fact_population  pop ON l.country = pop.country
                                    AND l.year::integer = pop.year
                                    AND COALESCE(NULLIF(l.age_group, ''), '15-74') = pop.age
                                    AND pop.population_type = 'individuals'
LEFT JOIN macro.fact_population  ind ON l.country = ind.country
                                    AND l.year::integer = ind.year
                                    AND ind.age = '15-74'
                                    AND ind.population_type = 'individuals'
LEFT JOIN macro.fact_population  hh  ON l.country = hh.country
                                    AND l.year::integer = hh.year
                                    AND hh.age = '15-74'
                                    AND hh.population_type = 'households'
WHERE l.year >= '2013'
