-- SVOD account sharing rate for specific countries
SELECT country, date, ROUND(AVG(value) * 100) AS value
FROM nordic
WHERE type = 'account_sharing'
  AND category = 'online_video'
  AND dim = 'svod'
  AND country IN ({country_list})
GROUP BY country, date
ORDER BY country, date
