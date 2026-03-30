-- Monthly SVOD spend in a single country
SELECT date, ROUND(AVG(value)) AS value
FROM nordic
WHERE type = 'spend'
  AND category = 'online_video'
  AND dim = 'ssvod'
  AND segment = 'subscribers'
  AND country = '{country}'
GROUP BY date
ORDER BY date
