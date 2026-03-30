-- Top streaming services by gross access (latest year, population-weighted)
SELECT s.name AS service, ROUND(SUM(n.value * p.value) / SUM(p.value) * 100) AS value
FROM nordic n
JOIN fact_population p ON n.country = p.country
  AND CAST(n.year AS TEXT) = p.year
  AND p.population_type = 'households'
JOIN dim_service s ON n.service = s.service
WHERE n.type = 'gross_access'
  AND n.year = (SELECT MAX(year) FROM nordic WHERE type = 'gross_access')
  AND n.quarter IN (1, 3)
GROUP BY s.name
HAVING ROUND(SUM(n.value * p.value) / SUM(p.value) * 100) > 0
ORDER BY ROUND(SUM(n.value * p.value) / SUM(p.value) * 100) DESC
LIMIT 20
