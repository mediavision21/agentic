-- Compare multiple services in a single country
SELECT n.service AS service, n.date, ROUND(AVG(n.value) * 100) AS value
FROM nordic n
WHERE n.type = 'reach_service_weekly'
  AND n.category = 'online_video'
  AND n.service IN ({service_list})
  AND n.country = '{country}'
  AND n.age = '15-74'
GROUP BY n.service, n.date
ORDER BY n.date
