-- Single country, latest value only
SELECT country, date, ROUND(AVG(value) {value_expr}) AS value
FROM nordic
WHERE type = '{type}'
  AND category = '{category}'
  AND dim = '{dim}'
  AND country = '{country}'
  AND year = {year}
GROUP BY country, date
ORDER BY date DESC
LIMIT 1
