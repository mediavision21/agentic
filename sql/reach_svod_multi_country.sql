-- Daily SVOD reach across Nordic countries
SELECT country, date, ROUND(AVG(value) * 100) AS value
FROM nordic
WHERE type = 'reach'
  AND category = 'online_video'
  AND dim = 'svod'
  AND quarter IN (1, 3)
  AND (service IS NULL)
  AND age = '15-74'
GROUP BY country, date
ORDER BY country, date
