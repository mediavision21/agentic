-- Reach by age group over time in a single country
SELECT date, age,
  ROUND(AVG(value) * 100) AS value
FROM nordic
WHERE type = 'reach'
  AND category = 'online_video'
  AND dim = '{dim}'
  AND country = '{country}'
  AND age != '15-74'
GROUP BY date, age
ORDER BY date, age
