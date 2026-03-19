# nordic — semantic notes

## Table structure
Long-format KPI measurement table for Nordic media markets. Data spans **2005–2025**.
Each row = one measurement for one unique combination of (country, year, quarter, category, kpi_type, kpi_dimension, service_id, age_group, population_segment).
The `value` column unit differs per kpi_type — NEVER aggregate or compare values across different kpi_types.

`kpi_type` ending in `_service` measures a single service identified by `service_id`. Without the suffix, `service_id` is NULL and the row measures the whole market segment.

## Column values
- country: denmark, finland, norway, sweden  (full names)
- year: integer (e.g. 2024)
- quarter: 1, 2, 3, 4  (integer)
- period_date: DATE — first day of the quarter (2024-01-01, 2024-04-01, 2024-07-01, 2024-10-01). Use this as the x-axis for time series plots and for ORDER BY. It is directly usable by Observable Plot as a date axis.
- category: cinema, dvd_blu_ray, online_video, tv, tvod

## Data availability by country
- sweden: q1, q2, q3, q4
- norway, denmark, finland: q1 and q3 only

## kpi_type demographics

Household vs individual is implicit in the kpi_type — not stored as a column.
Subscription/payment KPIs (penetration, spend, churn_intention, stacking, account_sharing, gross_access) are **household-level**.
Viewing/reach KPIs (reach, viewing_time) are **individual-level**.

### reach
- Unit: ratio 0.0–1.0 (% of population who watched in the past week)
- category: online_video, tv
- kpi_dimension: '', ads_ott, avod, bsvod, fast, genre, hvod, online_excluding_social, online_total, public_service, social, ssvod, svod
- age_group: available only when kpi_dimension IN ('', 'online_excluding_social', 'online_total', 'social')
- population_segment: viewers
- countries: all four
- years: 2010–2025

### reach_monthly
- Unit: ratio 0.0–1.0 (% of population who used in the past month)
- category: cinema, dvd_blu_ray, tvod  (NOT online_video or tv)
- kpi_dimension: '' (always empty)
- age_group: none
- population_segment: none
- countries: all four
- years: 2012–2025

### reach_weekly
- Unit: ratio 0.0–1.0
- category: online_video
- kpi_dimension: online_total
- countries: sweden only
- years: 2010–2025

### reach_service
- Unit: ratio 0.0–1.0 (weekly reach of a specific streaming service)
- category: online_video
- kpi_dimension: '', avod, bsvod, hvod, ssvod, svod  (the bundle type the user accessed through)
- age_group: none
- population_segment: none
- countries: all four
- years: 2011–2025

### reach_service_weekly
- Unit: ratio 0.0–1.0
- category: online_video
- kpi_dimension: '' (always empty)
- countries: sweden only
- years: 2023–2025  (very limited data)

### penetration
- Unit: ratio 0.0–1.0 (% of households/individuals subscribing)
- category: online_video → dimensions: bsvod, hvod, ott, ssvod, svod, tve
            tv          → dimensions: fta, illegal_iptv, pay_tv_channel
- age_group: none
- population_segment: none
- countries: all four
- years: 2005–2025

### penetration_service
- Unit: ratio 0.0–1.0 (penetration of a specific service)
- category: online_video, tv
- kpi_dimension: '', bsvod, hvod, ssvod, svod
- age_group: none
- population_segment: none
- countries: all four
- years: 2005–2025

### spend
- Unit: local currency per subscriber/user per month — SEK (sweden), NOK (norway), DKK (denmark), EUR (finland)
- To convert to EUR: join `fact_fx_rate_quarterly` on `period_key = '2025q4'` and `currency_code`, then multiply `value * rate_to_eur`
- Value range: ~8–418
- category: online_video, tv → population_segment: subscribers
            cinema, dvd_blu_ray, tvod → population_segment: users
- kpi_dimension: '' or ssvod
- countries: all four
- years: 2012–2025

### spend_service
- Unit: local currency per subscriber per month — SEK (sweden), NOK (norway), DKK (denmark), EUR (finland)
- To convert to EUR: join `fact_fx_rate_quarterly` on `period_key = '2025q4'` and `currency_code`, then multiply `value * rate_to_eur`
- Value range: ~17–650
- category: tv
- kpi_dimension: '' (always empty)
- population_segment: subscribers
- countries: all four
- years: 2008–2025

### viewing_time
- Unit: minutes per day per viewer
- Value range: ~15–208
- category: online_video, tv
- kpi_dimension: '', genre, old_online_total, online_excluding_social, social
- age_group: available when kpi_dimension IN ('', 'old_online_total', 'online_excluding_social', 'social')
- population_segment: viewers (most dims) or genre_viewers (only when kpi_dimension='genre')
- countries: all four
- years: 2010–2025

### viewing_time_service
- Unit: minutes per day per viewer
- Value range: ~0–309
- category: online_video
- kpi_dimension: '', avod, bsvod, hvod, ssvod
- population_segment: viewers
- countries: all four
- years: 2011–2025

### churn_intention
- Unit: ratio 0.0–1.0 (% of subscribers intending to cancel)
- Value range: ~0.06–0.22
- category: tv → kpi_dimension: '' (traditional pay TV churn)
            online_video → kpi_dimension: svod
- population_segment: subscribers
- countries: all four
- years: 2005–2025

### churn_intention_service
- Unit: ratio 0.0–1.0 (churn intention for a specific service)
- category: tv
- kpi_dimension: '' (always empty)
- population_segment: subscribers
- countries: all four
- years: 2009–2025



### stacking
- Unit: average number of paid services per subscriber (e.g. 1.85 = holds ~2 services on average)
- Value range: 0–3.15
- category: online_video
- kpi_dimension: svod, ssvod, hvod
- population_segment: subscribers
- countries: all four
- years: 2013–2025

### account_sharing
- Unit: ratio 0.0–1.0 (% of accounts being shared)
- Value range: ~0.12–0.50
- category: online_video
- kpi_dimension: svod, ssvod
- population_segment: subscribers
- countries: finland, sweden only
- years: 2014–2025

### gross_access
- Unit: ratio 0.0–1.0 (% of households that have access, e.g. 0.61 = 61% of households)
- Value range: 0.61–0.78
- category: online_video
- kpi_dimension: svod
- countries: finland, sweden only
- years: 2024–2025  (very limited data)

### gross_access_service
- Unit: ratio 0.0–1.0 (subscriber penetration for a specific service)
- category: online_video
- kpi_dimension: '' (always empty)
- countries: all four
- years: 2012–2025

## comment column
Internal analyst notes — not for display. Key patterns:
- `removed YYYYQN` — series discontinued
- `changed to X YYYYQN` — service renamed (e.g. `cmore` → `tv4_play` from 2024q2, `max` → `hbo_max` from 2024q2–q3)
- `method change YYYYQN` — methodology changed, breaks time series comparability

Check `comment` if a time series looks unexpectedly broken.

## Duplicate rows and aggregation
nordic contains multiple rows per (country, period_date, kpi_type, kpi_dimension) because:
- age_group creates one row per age bucket + one for the total (empty age_group)
- population_segment splits rows (e.g. viewers vs genre_viewers)
- kpi_detail was dropped from the source table — rows that differed only by kpi_detail now appear identical except for value
- _service kpi_types: service_id was dropped — rows for different services are collapsed

**Rule: always GROUP BY every non-value column in your SELECT, and use AVG(value).**

Example correct pattern:
```sql
SELECT country, period_date, kpi_dimension, AVG(value) AS value
FROM macro.nordic
WHERE kpi_type = 'reach' AND category = 'online_video' AND kpi_dimension = 'svod'
GROUP BY country, period_date, kpi_dimension
ORDER BY country, period_date
```

Special case — reach_monthly spans three categories (cinema, dvd_blu_ray, tvod).
Either filter to one category or include category in GROUP BY:
```sql
SELECT country, period_date, category, AVG(value) AS value
FROM macro.nordic
WHERE kpi_type = 'reach_monthly'
GROUP BY country, period_date, category
ORDER BY country, period_date, category
```

AVG is correct for all kpi_types. Do not use SUM unless explicitly asked for a total count.

## population_segment
Filters the base population — does not indicate household vs individual:
- NULL → whole population
- `subscribers` → paying subscribers only
- `viewers` / `genre_viewers` → those who actually watched

## NULL handling for optional columns
kpi_dimension, age_group and population_segment are NULL for most kpi_types.
- NEVER filter them with = '' — that returns 0 rows
- NEVER filter out age_group = '' or population_segment = '' or kpi_dimension = '' unless intentional
- Only add a filter on these columns when the user explicitly asks for a specific age group or population segment
- If you must exclude nulls, use IS NOT NULL — but usually just omit the filter entirely

## age_group labeling
When age_group is selected in a query, always convert empty/null to a display label:
```sql
COALESCE(NULLIF(age_group, ''), 'All ages') AS age_group
```
- Empty age_group = the total/all-ages row. Always label it 'All ages'.
- Non-empty values are age buckets (e.g. '15-29', '30-49', '50-74').
- When the user asks for all age groups, include the 'All ages' total row alongside the buckets.
- When the user does NOT ask for age groups, add `AND (age_group IS NULL OR age_group = '')` to filter to totals only.

## Choosing the right chart type — time series vs bar

**When period_date is in the SELECT, always use lineY — never barY.**

If the query returns `(country, period_date, value)` or `(period_date, category, value)`, the x-axis is time. Using barY here squashes multiple countries/categories into stacked/overlapping bars that are unreadable.

Correct plot config for `(country, period_date, value)`:
```json
{
  "marks": [{"type": "lineY", "x": "period_date", "y": "value", "stroke": "country"}],
  "color": {"legend": true}
}
```

barY is only appropriate when:
- x-axis is a non-time categorical column (e.g. country, service, category) AND there is no period_date in the result
- The intent is a snapshot comparison, not a trend over time

## Multiple category series in a single chart
When the result has a string/categorical column alongside period_date and value (e.g. `category`, `kpi_dimension`, `service`), each distinct value must become its own series — never aggregate or collapse them.

Set `stroke` to that column so Observable Plot draws one line per value:
```json
{
  "marks": [{"type": "lineY", "x": "period_date", "y": "value", "stroke": "category"}],
  "color": {"legend": true}
}
```

Rule: if the SELECT contains any non-date, non-numeric, non-country column (e.g. `category`, `kpi_dimension`, `service`, `age_group`), that column MUST appear as `stroke` (for lineY) or `fill` (for barY) in the plot config. Never omit it — doing so squashes all series into one.

## Multi-dimension time series (period_date × country × age_group)
When a query returns period_date as x-axis and has both country and age_group as dimensions, create a composite series label:
```sql
country || ' · ' || COALESCE(NULLIF(age_group, ''), 'All ages') AS series
```
Then use `series` as the stroke column in the plot config. This produces one clearly labelled line per country/age combination.

If only country varies (no age_group breakdown), use `country` as stroke directly.

## Value formatting in SQL
Apply the correct formula in the SELECT clause when computing the value column:

Percentage metrics (ratio × 100, ROUND to 0 decimals — display as whole number like 75 not 0.75):
- reach, reach_weekly, reach_monthly, reach_service, reach_service_weekly → ROUND(AVG(value) * 100) AS value
- penetration, penetration_service → ROUND(AVG(value) * 100) AS value
- churn_intention, churn_intention_service → ROUND(AVG(value) * 100) AS value
- account_sharing → ROUND(AVG(value) * 100) AS value
- gross_access, gross_access_service → ROUND(AVG(value) * 100) AS value

Currency metrics (local currency/month, keep 0 decimals):
- spend, spend_service → ROUND(AVG(value)) AS value

Time metrics (minutes/day, 1 decimal):
- viewing_time, viewing_time_service → ROUND(AVG(value)::numeric, 1) AS value

Count metrics (keep 2 decimals):
- stacking → ROUND(AVG(value)::numeric, 2) AS value

## kpi_type + dimension meaning (what the data represents)

### reach
- svod: % of population who watched paid streaming (Netflix, HBO, etc.) in past week
- avod: % of population who watched free ad-supported streaming in past week
- online_total: % of population who watched any online video (incl. social) in past week
- online_excluding_social: % of population who watched online video excluding social media in past week
- social: % of population who used social media video (YouTube, TikTok, Instagram etc.) in past week
- fta: % of population who watched free-to-air broadcast TV in past week
- public_service: % of population who used public broadcaster services (NRK, DR, SVT, YLE) in past week
- ssvod: % watching single standalone SVOD subscriptions in past week
- bsvod: % watching bundled SVOD (included in broadband/telco package) in past week
- genre: weekly reach broken down by content genre — use kpi_detail to filter genre: `drama_total`, `drama_local`, `drama_foreign`, `entertainment_total`, `entertainment_local`, `film_local`, `film_foreign`, `tv_series_local`, `tv_series_foreign`, `sports_total`, `sports_local`, `sports_foreign`, `factual_documentary`, `family_kids`, `news_debate`, `music`, `gaming_esport`, `other`
- ads_ott: % who watched ad-supported OTT services in past week
- fast: % who watched free ad-supported streaming TV channels in past week

### penetration
- svod: % of households subscribing to paid streaming services
- ssvod: % of households with standalone SVOD subscriptions
- bsvod: % of households with bundled SVOD (via ISP/telco)
- ott: % of households with any OTT service (svod + avod + tvod combined)
- tve: % of households using TV everywhere (broadcaster streaming apps)
- fta: % of households receiving free-to-air television
- pay_tv_channel: % of households subscribing to traditional pay TV channels
- illegal_iptv: % of households using illegal IPTV services
- hvod: % of households with hybrid VOD access

### viewing_time (minutes per day)
- '' (empty): total average daily viewing across all media
- online_excluding_social: avg daily minutes watching online video (excl. social)
- social: avg daily minutes on social media video platforms
- genre: avg daily minutes by content genre (use with age_group for demographic breakdown)
- old_online_total: legacy total online metric (historical data only, replaced by online_excluding_social)

### spend (local currency per month)
- '' (empty) + subscribers: average monthly ARPU for pay TV or SVOD subscribers
- ssvod + subscribers: average monthly spend on standalone SVOD subscriptions
- '' (empty) + users: average monthly consumer spend (cinema tickets, DVD, TVOD rentals)

### churn_intention
- svod + online_video: % of SVOD subscribers intending to cancel their streaming subscription
- '' + tv: % of pay TV subscribers intending to cancel their traditional TV package

### stacking (average number of services)
- svod: avg number of SVOD subscriptions held simultaneously per subscriber
- ssvod: avg standalone SVOD services per subscriber
- hvod: avg hybrid VOD services per subscriber

## Supporting tables (macro schema)

| table                   | purpose                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `dim_period`            | maps (year, quarter) to display labels and sortable `period_sort` int, e.g. `20241` = Q1 2024            |
| `dim_service`           | maps `service_id` to `canonical_name` + flags: `is_streaming_service`, `is_avod`, `is_fast`, `is_public_service`, `is_social_video` |
| `dim_country`           | maps country codes to display labels                                                                      |
| `fact_population`       | population 15–74 per country/year by `population_type` (`individuals` or `households`) — use for cross-country weighting |
| `fact_fx_rate_quarterly`| FX rates per quarter — join on `period_key` and `currency_code`, multiply `value * rate_to_eur`          |
| `insight_text`          | editorial commentary rows — use as context alongside numeric KPI data                                     |

## Cross-country quarter normalization
Sweden has data for all 4 quarters; Norway, Denmark, Finland have Q1 and Q3 only.

**Never use a global MAX(period_date) across countries** — Sweden's Q4 will shadow other countries that only have Q3.

When querying the "latest available" data per country, always get the max per country:
```sql
WITH latest AS (
    SELECT country, MAX(period_date) AS period_date
    FROM macro.nordic
    WHERE kpi_type = '<kpi_type>'
    GROUP BY country
)
SELECT n.country, n.period_date, ROUND(AVG(n.value) * 100) AS value
FROM macro.nordic n
JOIN latest l USING (country, period_date)
WHERE n.kpi_type = '<kpi_type>'
  AND n.kpi_dimension = '<dim>'
GROUP BY n.country, n.period_date
ORDER BY n.country
```

For time series across all countries: just SELECT all periods — the chart will naturally align each country to its own available quarters. Do NOT filter to a single MAX period.

## Querying guidelines
1. ALWAYS use table `macro.nordic`.
2. ALWAYS filter kpi_type to exactly one value.
3. ALWAYS GROUP BY every non-value column in SELECT — see Duplicate rows section.
4. ALWAYS apply the value formula from the Value formatting section above.
5. Use period_date for time-series x-axis and ORDER BY. Use year/quarter only for WHERE filters.
6. Use the demographics section and kpi_type+dimension meaning above to pick correct kpi_dimension and category.
7. When NOT asked about age groups: add `AND (age_group IS NULL OR age_group = '')` to get totals only.
8. When asked about age groups: select `COALESCE(NULLIF(age_group, ''), 'All ages') AS age_group` and GROUP BY it.
9. When result has period_date × country × age_group: add a `series` composite column and use it as plot stroke.
10. Check the `comment` column if a time series looks broken — it may flag a method change or service rename.
