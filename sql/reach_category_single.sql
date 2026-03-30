-- Reach of a category segment in a single country
SELECT date, ROUND(AVG(value) * 100) AS value
FROM nordic
WHERE type = 'reach'
  AND category = 'online_video'
  AND dim = '{dim}'
  AND country = '{country}'
  AND (service IS NULL)
  AND age = '15-74'
GROUP BY date
ORDER BY date
