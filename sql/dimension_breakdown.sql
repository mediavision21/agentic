-- All dimensions for a KPI in a single country
SELECT dim, date, ROUND(AVG(value) * 100) AS value
FROM nordic
WHERE type = '{type}'
  AND category = '{category}'
  AND country = '{country}'
  AND dim IS NOT NULL
GROUP BY dim, date
ORDER BY date, dim
