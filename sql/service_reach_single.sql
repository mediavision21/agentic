-- Service weekly reach in a single country
SELECT date, ROUND(AVG(value) * 100) AS value
FROM nordic
WHERE type = 'reach_service_weekly'
  AND category = 'online_video'
  AND service = '{service}'
  AND country = '{country}'
  AND age = '15-74'
GROUP BY date
ORDER BY date
