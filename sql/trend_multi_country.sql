-- Multi-country time-series trend
SELECT country, date, ROUND(AVG(value) {value_expr}) AS value
FROM nordic
WHERE type = '{type}'
  AND category = '{category}'
  AND dim = '{dim}'
  AND quarter IN (1, 3)
GROUP BY country, date
ORDER BY country, date
