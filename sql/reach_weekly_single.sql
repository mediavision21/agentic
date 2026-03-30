-- Weekly reach of online video in a single country
SELECT date, ROUND(AVG(value) * 100) AS value
FROM nordic
WHERE type = 'reach_weekly'
  AND category = 'online_video'
  AND dim = 'online_total'
  AND country = '{country}'
GROUP BY date
ORDER BY date
