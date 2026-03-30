-- Stacking trend for a specific dimension across Nordic countries
SELECT country, date, ROUND(AVG(value), 2) AS value
FROM nordic
WHERE type = 'stacking'
  AND category = 'online_video'
  AND dim = '{dim}'
  AND quarter IN (1, 3)
GROUP BY country, date
ORDER BY country, date
