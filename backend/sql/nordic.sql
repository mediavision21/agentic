CREATE OR REPLACE VIEW macro.nordic AS
SELECT
    year::integer                                                           AS year,
    CASE quarter
        WHEN 'q1' THEN 1
        WHEN 'q2' THEN 2
        WHEN 'q3' THEN 3
        WHEN 'q4' THEN 4
    END::integer                                                            AS quarter,
    MAKE_DATE(
        year::integer,
        CASE quarter WHEN 'q1' THEN 1 WHEN 'q2' THEN 4 WHEN 'q3' THEN 7 WHEN 'q4' THEN 10 END,
        1
    )                                                                       AS period_date,
    CASE country
        WHEN 'dk' THEN 'denmark'
        WHEN 'fi' THEN 'finland'
        WHEN 'no' THEN 'norway'
        WHEN 'se' THEN 'sweden'
    END                                                                     AS country,
    NULLIF(TRIM(category), '')                                              AS category,
    NULLIF(TRIM(service_id), '')                                            AS service_id,
    NULLIF(TRIM(REGEXP_REPLACE(kpi_type, '_service$', '')), '')             AS kpi_type,
    NULLIF(TRIM(kpi_dimension), '')                                         AS kpi_dimension,
    COALESCE(NULLIF(age_group, ''), '15-74') 								AS age_group,
    NULLIF(TRIM(population_segment), '')                                    AS population_segment,
    value
FROM macro.nordic_long_v2;