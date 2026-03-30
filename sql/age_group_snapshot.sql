-- Viewing time by age group (latest snapshot)
WITH latest AS (
    SELECT country, MAX(date) AS date
    FROM nordic
    WHERE type = '{type}' AND category = 'online_video'
      AND dim = '{dim}'
    GROUP BY country
)
SELECT n.age, ROUND(AVG(n.value), 1) AS value
FROM nordic n
JOIN latest l USING (country, date)
WHERE n.type = '{type}'
  AND n.category = 'online_video'
  AND n.dim = '{dim}'
  AND n.age != '15-74'
  AND (n.service IS NULL OR n.service = '')
GROUP BY n.age
ORDER BY n.age
