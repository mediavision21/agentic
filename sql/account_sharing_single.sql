-- Account sharing rate in a single country
SELECT date, ROUND(AVG(value) * 100) AS value
FROM nordic
WHERE type = 'account_sharing'
  AND dim = '{dim}'
  AND country = '{country}'
GROUP BY date
ORDER BY date
