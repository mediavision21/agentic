-- Single country time-series trend
SELECT date, ROUND(AVG(value) {value_expr}) AS value
FROM nordic
WHERE type = '{type}'
  AND category = '{category}'
  AND dim = '{dim}'
  AND country = '{country}'
GROUP BY date
ORDER BY date
