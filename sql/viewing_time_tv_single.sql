-- TV viewing time trend in a single country
SELECT date, ROUND(AVG(value), 1) AS value
FROM nordic
WHERE type = 'viewing_time'
  AND category = 'tv'
  AND country = '{country}'
  AND age = '{age}'
GROUP BY date
ORDER BY date
