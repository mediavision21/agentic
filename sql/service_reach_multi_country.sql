-- Service weekly reach across Nordic countries
SELECT country, date, ROUND(AVG(value) * 100) AS value
FROM nordic
WHERE type = 'reach_service_weekly'
  AND category = 'online_video'
  AND service = '{service}'
  AND quarter IN (1, 3)
  AND age = '15-74'
GROUP BY country, date
ORDER BY country, date
