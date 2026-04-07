# macro.nordic

Long-format KPI measurement database view for Nordic media markets. Data spans **2005–2025**.
Each row is one measurement for one unique combination of (country, year, quarter, category, kpi_type, kpi_dimension, service_id, age_group, population_segment).
The `value` column unit differs per kpi_type — NEVER aggregate or compare values across different kpi_types.

BAD — different kpi_types have different units, summing across them is meaningless:
```sql
SELECT category, SUM(value) FROM macro.nordic
```
OKAY — filter to one kpi_type, then aggregate:
```sql
SELECT category, AVG(value) FROM macro.nordic WHERE kpi_type = 'reach' GROUP BY category
```
[FIX] the original OKAY example was truncated (`kpi_type='c`). Replaced with complete example above.

`kpi_type` ending in `_service` measures a single service identified by `service_id`. Without the suffix, `service_id` is NULL and the row measures the whole market segment.

## country
denmark, finland, norway, sweden

- sweden: q1, q2, q3, q4
- norway, denmark, finland: q1 and q3 only

## year
integer (e.g. 2024)
## quarter
1, 2, 3, 4  (integer)

## period_date
DATE — first day of the quarter (2024-01-01, 2024-04-01, 2024-07-01, 2024-10-01). Use this as the x-axis for time series plots and for ORDER BY. It is directly usable by Observable Plot as a date axis.

## category
possible values are
- online_video: has most kpi_type as its subtype
- tvod: tv on demand
- cinema: only have reach_monthly, spend as sub kpi_type
- dvd_blu_ray: only have reach_monthly, spend as sub kpi_type
- tv: only have reach, churn_intention, spend, viewing_time as sub kpi_type
[FIX] original said "reach_weekly" for cinema/dvd_blu_ray but kpi_type section says reach_monthly for those categories. Also tv has more kpi_types than just reach_weekly+spend. Verify these mappings.

## [nordic-kpi_type.md]
## [nordic-kpi_dimension.md]
## [nordic-service_id.md]:

## comment column
Internal analyst notes — not for display. Key patterns:
- `removed YYYYQN` — series discontinued
- `changed to X YYYYQN` — service renamed (e.g. `cmore` → `tv4_play` from 2024q2, `max` → `hbo_max` from 2024q2–q3)
- `method change YYYYQN` — methodology changed, breaks time series comparability

Check `comment` if a time series looks unexpectedly broken.

## population columns
- `population`: individuals for this row's `age_group` and country/year — correct for age-group-specific weighting
- `population_1574`: always individuals aged 15-74, regardless of row's age_group — use for country-weighting when aggregating across age groups
- `population_household`: households aged 15-74 for this country/year — use for household-weighted averages

All three columns are already present on every row in `macro.nordic`.
**NEVER** join `macro.population`, `fact_population`, or any external population table — the data is already here.

## service flag columns
Denormalized from `dim_service`. NULL on rows with no service (`canonical_name IS NULL`).
- `is_social_video`: TRUE for social video platforms (YouTube, TikTok, etc.)
- `is_streaming_service`: TRUE for SVOD/streaming services
- `is_avod`: TRUE for ad-supported VOD
- `is_fast`: TRUE for free ad-supported streaming TV channels
- `is_public_service`: TRUE for public broadcaster services

Use these directly in WHERE instead of subqueries on `dim_service`.

## kpi_detail
Granular sub-dimension for genre breakdowns (e.g. `drama_foreign`, `news_debate`, `factual_documentary`, `drama_local`, `sports_foreign`). NULL on non-genre rows.

## population_segment
Filters the base population — does not indicate household vs individual:
- NULL → whole population
- `subscribers` → paying subscribers only
- `viewers` / `genre_viewers` → those who actually watched

## age_group

When the user does NOT ask for age groups, add `AND age_group = '15-74'` to get the total population row.
When the user asks for age group breakdown, filter `AND age_group == '{age_group}'` to get individual age bands.
// This column can link as foreign key to population if the age_group is '15-74'

values
- 15-24
- 25-34
- 35-44
- 45-54
- 55-64
- 65-74
- 15-74




