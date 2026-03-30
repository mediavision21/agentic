-- SVOD gross access across countries
SELECT country, date, ROUND(AVG(value) * 100) AS value
FROM nordic
WHERE type = 'gross_access'
  AND dim = 'svod'
  AND (service IS NULL)
  AND quarter IN (1, 3)
GROUP BY country, date
ORDER BY country, date
