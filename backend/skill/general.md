## Querying guidelines
1. ALWAYS use database view `macro.nordic`.
2. ALWAYS filter kpi_type to exactly one value.
3. ALWAYS GROUP BY every non-value column in SELECT — see Duplicate rows section.
4. ALWAYS apply the value formula from the Value formatting section in datahandle.md.
5. Use period_date for time-series x-axis and ORDER BY. Use year/quarter only for WHERE filters.
6. Use kpi_type and kpi_dimension definitions to pick correct kpi_dimension and category.
9. When result has period_date × country × age_group: add a `series` composite column and use it as plot stroke.
10. Check the `comment` column if a time series looks broken — it may flag a method change or service rename.
11. When querying more than one country: ALWAYS add `AND quarter IN (1, 3)` and use population-weighted averages.
12. When reach is requested without a specified time period, default to daily reach (kpi_type = 'reach' or 'reach_service'). Only use weekly/monthly variants when explicitly requested.