-- TV reach by age group in a single country
SELECT age, date, ROUND(AVG(value) * 100) AS value
FROM nordic
WHERE type = 'reach'
  AND category = 'tv'
  AND country = '{country}'
  AND age <> '15-74'
GROUP BY age, date
ORDER BY age, date
