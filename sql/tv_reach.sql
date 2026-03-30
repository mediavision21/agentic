-- Traditional TV reach across Nordic countries
SELECT country, date, ROUND(AVG(value) * 100) AS value
FROM nordic
WHERE type = 'reach'
  AND category = 'tv'
  AND dim IS NULL
  AND quarter IN (1, 3)
  AND (service IS NULL)
  AND age = '15-74'
GROUP BY country, date
ORDER BY country, date
