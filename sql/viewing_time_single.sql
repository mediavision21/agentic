-- Viewing time by dimension in a single country
SELECT date, dim,
  ROUND(AVG(value), 1) AS value
FROM nordic
WHERE type = 'viewing_time'
  AND category = 'online_video'
  AND dim IN ('social', 'online_excluding_social')
  AND country = '{country}'
  AND (service IS NULL)
  AND age = '15-74'
GROUP BY date, dim
ORDER BY date
