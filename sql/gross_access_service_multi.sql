-- Per-service gross access across Nordic countries
SELECT country, date, ROUND(AVG(value) * 100) AS value
FROM nordic
WHERE type = 'gross_access'
  AND service = '{service}'
  AND quarter IN (1, 3)
GROUP BY country, date
ORDER BY country, date
