-- Population-weighted daily reach of online video
SELECT n.date,
  CASE n.dim
    WHEN 'social' THEN 'Social video'
    WHEN 'online_excluding_social' THEN 'Other online'
    WHEN 'online_total' THEN 'Total online'
  END AS reach_type,
  ROUND(SUM(n.value * p.value) / SUM(p.value) * 100) AS value
FROM nordic n
JOIN fact_population p ON n.country = p.country
  AND CAST(n.year AS TEXT) = p.year
  AND p.population_type = 'individuals'
WHERE n.type = 'reach'
  AND n.category = 'online_video'
  AND n.dim IN ('social', 'online_excluding_social', 'online_total')
  AND (n.service IS NULL OR n.service = '')
  AND n.age = '15-74'
  AND n.quarter IN (1, 3)
GROUP BY n.date, n.dim
ORDER BY n.date
