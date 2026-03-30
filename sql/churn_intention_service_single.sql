-- TV churn intention for a specific service in one country
SELECT date, ROUND(AVG(value) * 100) AS value
FROM nordic
WHERE type = 'churn_intention'
  AND category = 'tv'
  AND service = '{service}'
  AND country = '{country}'
GROUP BY date
ORDER BY date
