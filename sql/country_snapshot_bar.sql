-- Latest viewing time by country (bar chart)
WITH latest AS (
    SELECT country, MAX(date) AS date
    FROM nordic
    WHERE type = '{type}' AND category = '{category}'
      AND dim = '{dim}'
    GROUP BY country
)
SELECT n.country, ROUND(AVG(n.value), 1) AS value
FROM nordic n
JOIN latest l USING (country, date)
WHERE n.type = '{type}'
  AND n.category = '{category}'
  AND n.dim = '{dim}'
  AND (n.service IS NULL OR n.service = '')
  AND n.age = '15-74'
GROUP BY n.country
ORDER BY value DESC
