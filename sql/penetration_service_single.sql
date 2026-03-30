-- Per-service penetration trend in a single country
SELECT date, ROUND(AVG(value) * 100) AS value
FROM nordic
WHERE type = 'penetration'
  AND service = '{service}'
  AND country = '{country}'
GROUP BY date
ORDER BY date
