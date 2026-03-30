-- Spend by category in a single country
SELECT date, ROUND(AVG(value)) AS value
FROM nordic
WHERE type = 'spend'
  AND category = '{category}'
  AND segment = '{segment}'
  AND country = '{country}'
GROUP BY date
ORDER BY date
