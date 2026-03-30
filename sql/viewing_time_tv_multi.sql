-- TV viewing time across Nordic countries
SELECT country, date, ROUND(AVG(value), 1) AS value
FROM nordic
WHERE type = 'viewing_time'
  AND category = 'tv'
  AND quarter IN (1, 3)
  AND age = '{age}'
GROUP BY country, date
ORDER BY country, date
