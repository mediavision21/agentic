-- Population-weighted total reach (any type) across Nordic countries
SELECT n.date,
  ROUND(SUM(n.value * p.value) / SUM(p.value) {value_expr}) AS value
FROM nordic n
JOIN fact_population p ON n.country = p.country
  AND CAST(n.year AS TEXT) = p.year
  AND p.population_type = 'individuals'
WHERE n.type = '{type}'
  AND n.category = '{category}'
  AND n.dim = '{dim}'
  AND (n.service IS NULL OR n.service = '')
  AND n.age = '{age}'
  AND n.quarter IN (1, 3)
GROUP BY n.date
ORDER BY n.date
