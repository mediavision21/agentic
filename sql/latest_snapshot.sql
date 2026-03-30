-- Latest value per country as bar chart
WITH latest AS (
    SELECT country, MAX(date) AS date
    FROM nordic
    WHERE type = '{type}' AND dim = '{dim}'
    GROUP BY country
)
SELECT n.country, n.date, ROUND(AVG(n.value) {value_expr}) AS value
FROM nordic n
JOIN latest l USING (country, date)
WHERE n.type = '{type}'
  AND n.dim = '{dim}'
GROUP BY n.country, n.date
ORDER BY value DESC
