-- TV churn intention for a specific service
SELECT country, date, ROUND(AVG(value) * 100) AS value
FROM nordic
WHERE type = 'churn_intention'
  AND category = 'tv'
  AND service = '{service}'
  AND quarter IN (1, 3)
GROUP BY country, date
ORDER BY country, date
