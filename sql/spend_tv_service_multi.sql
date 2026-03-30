-- TV spend for a specific service across countries
SELECT country, date, ROUND(AVG(value)) AS value
FROM nordic
WHERE type = 'spend'
  AND category = 'tv'
  AND service = '{service}'
  AND segment = 'subscribers'
  AND quarter IN (1, 3)
GROUP BY country, date
ORDER BY country, date
