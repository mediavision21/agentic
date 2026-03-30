-- Top streaming services by population-weighted weekly reach
WITH latest AS (
    SELECT country, MAX(date) AS date
    FROM nordic
    WHERE type = 'reach_service_weekly' AND category = 'online_video'
    GROUP BY country
)
SELECT s.name AS service,
  ROUND(SUM(n.value * p.value) / SUM(p.value) * 100) AS value
FROM nordic n
JOIN latest l USING (country, date)
JOIN dim_service s ON n.service = s.service
  AND ({service_filter})
JOIN fact_population p ON n.country = p.country
  AND CAST(n.year AS TEXT) = p.year
  AND p.population_type = 'individuals'
WHERE n.type = 'reach_service_weekly'
  AND n.category = 'online_video'
  AND n.age = '15-74'
GROUP BY s.name
ORDER BY value DESC
LIMIT 15
