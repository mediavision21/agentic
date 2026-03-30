-- Reach by country and age group combined
SELECT date,
  country || ' · ' || COALESCE(NULLIF(age, ''), '15-74') AS series,
  ROUND(AVG(value) * 100) AS value
FROM nordic
WHERE type = 'reach'
  AND category = 'online_video'
  AND dim = 'online_total'
  AND age != '15-74'
  AND quarter IN (1, 3)
GROUP BY date, country, age
ORDER BY date, series
