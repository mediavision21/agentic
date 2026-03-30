CREATE OR REPLACE VIEW macro.population AS
SELECT
    year::integer                                                           AS year,
    CASE country
        WHEN 'dk' THEN 'denmark'
        WHEN 'fi' THEN 'finland'
        WHEN 'no' THEN 'norway'
        WHEN 'se' THEN 'sweden'
    END                                                                     AS country,
	age,
    population_type,
    value AS population
FROM macro.fact_population;