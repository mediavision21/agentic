# population — DEPRECATED

Do NOT use `macro.population` or `fact_population`.

Population data is already denormalized into `macro.nordic`:
- `population` — individuals 15-74 per country/year
- `population_household` — households 15-74 per country/year

Use those columns directly for cross-country weighting. No JOIN needed.
