-- Spend by category across Nordic countries
SELECT country, date, ROUND(AVG(value)) AS value
FROM nordic
WHERE type = 'spend'
  AND category = '{category}'
  AND segment = '{segment}'
  AND quarter IN (1, 3)
GROUP BY country, date
ORDER BY country, date
