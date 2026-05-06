DROP VIEW if EXISTS macro.nordic_avg;
CREATE VIEW macro.nordic_avg AS
WITH nordic_existing AS (
    SELECT DISTINCT
        period_date, kpi_type, kpi_dimension, kpi_detail,
        age_group, population_segment, service_id, category, canonical_name
    FROM macro.nordic_base
    WHERE country = 'nordic'
),
aggregated AS (
    SELECT
        period_date,
        category,
        canonical_name,
        service_id,
        kpi_type,
        kpi_dimension,
        kpi_detail,
        age_group,
        population_segment,
        SUM(value * population_1574) / NULLIF(SUM(population_1574), 0)     AS value,
        MAX(is_social_video::int)::boolean                                  AS is_social_video,
        MAX(is_streaming_service::int)::boolean                             AS is_streaming_service,
        MAX(is_avod::int)::boolean                                          AS is_avod,
        MAX(is_fast::int)::boolean                                          AS is_fast,
        MAX(is_public_service::int)::boolean                                AS is_public_service,
        SUM(population)                                                     AS population,
        MAX(population_1574_nordic)                                         AS population_1574,
        MAX(population_household_nordic)                                    AS population_household,
        MAX(population_household_nordic)                                    AS population_household_nordic,
        MAX(population_1574_nordic)                                         AS population_1574_nordic
    FROM macro.nordic_base
    WHERE EXTRACT(MONTH FROM period_date) IN (1, 10)
    GROUP BY
        period_date, kpi_type, kpi_dimension, kpi_detail,
        age_group, population_segment, service_id, category, canonical_name
)
SELECT
    a.period_date,
    'nordic'                    AS country,
    a.category,
    a.canonical_name,
    a.service_id,
    a.kpi_type,
    a.kpi_dimension,
    a.kpi_detail,
    a.age_group,
    a.population_segment,
    a.value,
    a.is_social_video,
    a.is_streaming_service,
    a.is_avod,
    a.is_fast,
    a.is_public_service,
    a.population,
    a.population_1574,
    a.population_household,
    a.population_household_nordic,
    a.population_1574_nordic
FROM aggregated a
LEFT JOIN nordic_existing ne
    ON  ne.period_date        = a.period_date
    AND ne.kpi_type           IS NOT DISTINCT FROM a.kpi_type
    AND ne.kpi_dimension      IS NOT DISTINCT FROM a.kpi_dimension
    AND ne.kpi_detail         IS NOT DISTINCT FROM a.kpi_detail
    AND ne.age_group          IS NOT DISTINCT FROM a.age_group
    AND ne.population_segment IS NOT DISTINCT FROM a.population_segment
    AND ne.service_id         IS NOT DISTINCT FROM a.service_id
    AND ne.category           IS NOT DISTINCT FROM a.category
    AND ne.canonical_name     IS NOT DISTINCT FROM a.canonical_name
WHERE ne.period_date IS NULL;
