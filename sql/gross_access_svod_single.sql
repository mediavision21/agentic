-- SVOD gross access trend in a single country
SELECT date, ROUND(AVG(value) * 100) AS value
FROM nordic
WHERE type = 'gross_access'
  AND dim = 'svod'
  AND (service IS NULL)
  AND country = '{country}'
GROUP BY date
ORDER BY date
