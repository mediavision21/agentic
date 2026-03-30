-- TV spend for a specific service in one country
SELECT date, ROUND(AVG(value)) AS value
FROM nordic
WHERE type = 'spend'
  AND category = 'tv'
  AND service = '{service}'
  AND segment = 'subscribers'
  AND country = '{country}'
GROUP BY date
ORDER BY date
