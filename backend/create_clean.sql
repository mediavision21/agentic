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
    category,
	service_id,
    kpi_type,
    kpi_dimension,
    age_group,
    population_segment,
    value
FROM macro.nordic_long_v2;
