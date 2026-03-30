-- SVOD spending across Nordic countries
SELECT country, date, ROUND(AVG(value)) AS value
FROM nordic
WHERE type = 'spend'
  AND category = 'online_video'
  AND dim = 'ssvod'
  AND segment = 'subscribers'
  AND quarter IN (1, 3)
GROUP BY country, date
ORDER BY country, date
