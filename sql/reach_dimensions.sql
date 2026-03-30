-- Reach breakdown by dimension in a single country
SELECT date, dim,
  ROUND(AVG(value) * 100) AS value
FROM nordic
WHERE type = 'reach'
  AND category = 'online_video'
  AND dim IN ({dimension_list})
  AND country = '{country}'
  AND (service IS NULL)
  AND age = '15-74'
GROUP BY date, dim
ORDER BY date
