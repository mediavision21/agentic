DROP VIEW macro.nordic;

CREATE OR REPLACE VIEW macro.nordic AS
SELECT
    l.year::integer                                                         AS year,
    p.period_sort,
    p.period_label,
	p.quarter_label,
    CASE l.quarter
        WHEN 'q1' THEN 1
        WHEN 'q2' THEN 2
        WHEN 'q3' THEN 3
        WHEN 'q4' THEN 4
    END::integer                                                            AS quarter,
    MAKE_DATE(
        l.year::integer,
        CASE l.quarter WHEN 'q1' THEN 1 WHEN 'q2' THEN 4 WHEN 'q3' THEN 7 WHEN 'q4' THEN 10 END,
        1
    )                                                                       AS date,
    CASE l.country
        WHEN 'dk' THEN 'denmark'
        WHEN 'fi' THEN 'finland'
        WHEN 'no' THEN 'norway'
        WHEN 'se' THEN 'sweden'
    END                                                                     AS country,
    NULLIF(TRIM(l.category), '')                                            AS category,
    s.canonical_name                                                        AS canonical_name,
    NULLIF(TRIM(REGEXP_REPLACE(l.kpi_type, '_service$', '')), '')           AS kpi_type,
    NULLIF(TRIM(l.kpi_dimension), '')                                       AS kpi_dimension,
    COALESCE(NULLIF(l.age_group, ''), '15-74')                              AS age_group,
    NULLIF(TRIM(l.population_segment), '')                                  AS population_segment,
    l.value,
    pop.value                                                               AS population
FROM macro.nordic_long_v2       l
LEFT JOIN macro.dim_service           s   ON l.service_id = s.service_id
LEFT JOIN macro.dim_period            p   ON l.year = p.year AND l.quarter = p.quarter
LEFT JOIN macro.fact_population  pop ON l.country = pop.country
                                    AND l.year::integer = pop.year
                                    AND COALESCE(NULLIF(l.age_group, ''), '15-74') = pop.age
                                    AND pop.population_type = 'individuals';
