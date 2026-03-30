-- Stacking trend for a specific dimension in a single country
SELECT date, ROUND(AVG(value), 2) AS value
FROM nordic
WHERE type = 'stacking'
  AND category = 'online_video'
  AND dim = '{dim}'
  AND country = '{country}'
GROUP BY date
ORDER BY date
