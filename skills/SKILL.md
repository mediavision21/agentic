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

## kpi_type
Each kpi_type belongs to one or more categories. Filter kpi_type to exactly one value per query.
[FIX] original "its a sub type of category" — kpi_type is not a subtype of category; they are separate dimensions that constrain each other.

Household vs individual is implicit in the kpi_type — not stored as a column.
Subscription/payment KPIs (penetration, spend, churn_intention, stacking, account_sharing, gross_access) are **household-level**.
Viewing/reach KPIs (reach, viewing_time) are **individual-level**.


possible values are
### account_sharing
- Unit: ratio 0.0–1.0 (% of accounts being shared)
- Value range: ~0.12–0.50
- category: online_video
- kpi_dimension: svod, ssvod
- population_segment: subscribers
- countries: finland, sweden only
- years: 2014–2025
### churn_intention
- Unit: ratio 0.0–1.0 (% of subscribers intending to cancel)
- Value range: ~0.06–0.22
- category: tv → kpi_dimension: '' (traditional pay TV churn)
            online_video → kpi_dimension: svod
- population_segment: subscribers
- countries: all four
- years: 2005–2025
### gross_access
- Unit: ratio 0.0–1.0 (% of households that have access, e.g. 0.61 = 61% of households)
- Value range: 0.61–0.78
- category: online_video
- kpi_dimension: svod
- countries: finland, sweden only
- years: 2024–2025  (very limited data)

### penetration
- Unit: ratio 0.0–1.0 (% of households)
- category: online_video, tv
- population_segment: NULL (whole population)
- countries: all four
- years: 2005–2025
[FIX] penetration was missing unit/category/country/year metadata that other kpi_types have. Added based on pattern. Verify years range.

Dimensions (kpi_dimension → meaning):
- svod: % of households subscribing to paid streaming services
- ssvod: % of households with standalone SVOD subscriptions
- bsvod: % of households with bundled SVOD (via ISP/telco)
- ott: % of households with any OTT service (svod + avod + tvod combined)
- tve: % of households using TV everywhere (broadcaster streaming apps)
- fta: % of households receiving free-to-air television
- pay_tv_channel: % of households subscribing to traditional pay TV channels
- illegal_iptv: % of households using illegal IPTV services
- hvod: % of households with hybrid VOD access


### reach
- Unit: ratio 0.0–1.0 (daily reach — % of population who watched yesterday)
- Default reach type: when reach is requested without a specified time period, always use reach (daily). Use weekly or monthly variants only when explicitly requested.
- category: online_video, tv
- kpi_dimension: '', ads_ott, avod, bsvod, fast, genre, hvod, online_excluding_social, online_total, public_service, social, ssvod, svod
- age_group: available only when kpi_dimension IN ('', 'online_excluding_social', 'online_total', 'social'). When kpi_dimension = genre, population_segment = viewers.
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
- Unit: ratio 0.0–1.0 (daily reach of a specific streaming service)
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

### spend (local currency per month)
- Unit: local currency/month
- category: online_video, tv, cinema, dvd_blu_ray, tvod
- countries: all four
- years: 2005–2025
[FIX] spend was missing unit/category/country/year metadata. Added based on pattern. Verify.

Dimensions (kpi_dimension + population_segment → meaning):
- '' + subscribers: average monthly ARPU for pay TV or SVOD subscribers
- ssvod + subscribers: average monthly spend on standalone SVOD subscriptions
- '' + users: average monthly consumer spend (cinema tickets, DVD, TVOD rentals)


### stacking (average number of services)
- svod: avg number of SVOD subscriptions held simultaneously per subscriber
- ssvod: avg standalone SVOD services per subscriber
- hvod: avg hybrid VOD services per subscriber

### viewing_time (minutes per day)
- '' (empty): total average daily viewing across all media
- online_excluding_social: avg daily minutes watching online video (excl. social)
- social: avg daily minutes on social media video platforms
- genre: avg daily minutes by content genre (use with age_group for demographic breakdown)
- old_online_total: legacy total online metric (historical data only, replaced by online_excluding_social)
## kpi_dimension

Subdivides a kpi_type into finer segments. When service_id is NULL the row measures the whole market segment for that dimension. When service_id is set (only for _service kpi_types), it measures a specific service within that dimension.
[FIX] original "its a sub type of kpi_type. For rows have service_is is NULL..." had typo (service_is) and was unclear. Reworded.

possible values are
- ads_ott: % who watched ad-supported OTT services yesterday
- avod: % of population who watched free ad-supported streaming yesterday
- bsvod: % watching bundled SVOD (included in broadband/telco package) yesterday
- fast: % who watched free ad-supported streaming TV channels yesterday
- fta: % of population who watched free-to-air broadcast TV yesterday
- genre: daily reach broken down by content genre — use kpi_detail to filter genre: `drama_total`, `drama_local`, `drama_foreign`, `entertainment_total`, `entertainment_local`, `film_local`, `film_foreign`, `tv_series_local`, `tv_series_foreign`, `sports_total`, `sports_local`, `sports_foreign`, `factual_documentary`, `family_kids`, `news_debate`, `music`, `gaming_esport`, `other`
- hvod: % of households with hybrid VOD access
- illegal_iptv: % of households using illegal IPTV services
- old_online_total: legacy total online metric (historical data only, replaced by online_excluding_social)
- online_excluding_social: % of population who watched online video excluding social media yesterday
- online_total: % of population who watched any online video (incl. social) yesterday
- ott: % of households with any OTT service (svod + avod + tvod combined)
- pay_tv_channel: % of households subscribing to traditional pay TV channels
- public_service: % of population who used public broadcaster services (NRK, DR, SVT, YLE) yesterday
- social: % of population who used social media video (YouTube, TikTok, Instagram etc.) yesterday
- ssvod: % watching single standalone SVOD subscriptions yesterday
- svod: % of population who watched paid streaming (Netflix, HBO, etc.) yesterday
- tve: % of households using TV everywhere (broadcaster streaming apps)
## service_id:
- aaumalehti_sanomat
- aftenposten
- aftonbladet
- allente
- allente_stream
- altibox
- antenni_tv
- apple_tv
- bbc_nordic
- boxer
- britbox
- cirkus_tv
- cmore
- dagbladet
- dazn
- direktesport
- discovery
- disney
- dk4
- dna
- dr
- draken_film
- ekstrabladet
- elisa
- elisa_viihde
- eurosport
- expressen
- f1tv
- facebook
- filmfavoriter
- golf_tv
- hayu
- hbo_max
- helsingin_sanomat
- ilta_sanomat
- iltalehti
- instagram
- lionsgate
- mtv_katsomo
- netflix
- nextgen_tel
- nordisk_film
- norlys
- nrk
- other
- pluto_tv
- prime
- rakuten_tv
- riks_tv
- ruutu
- ruutu_netti
- samsung_tv
- skyshowtime
- snapchat
- staccs
- svt_play
- tele2
- tele2_play
- telenor
- telenor_stream
- telia
- telia_liiga
- telia_play
- tennis_tv
- tiktok
- tv2_play_dk
- tv2_play_no
- tv4_play
- twitch
- unknown
- ur_play
- vg
- viafree
- viaplay
- viasat
- waoo
- yle_areena
- yousee
- yousee_play
- youtube

## comment column
Internal analyst notes — not for display. Key patterns:
- `removed YYYYQN` — series discontinued
- `changed to X YYYYQN` — service renamed (e.g. `cmore` → `tv4_play` from 2024q2, `max` → `hbo_max` from 2024q2–q3)
- `method change YYYYQN` — methodology changed, breaks time series comparability

Check `comment` if a time series looks unexpectedly broken.

## population_segment
Filters the base population — does not indicate household vs individual:
- NULL → whole population
- `subscribers` → paying subscribers only
- `viewers` / `genre_viewers` → those who actually watched

## age_group

When the user asks for all age groups, means year include the '15-74'.
When the user does NOT ask for age groups, add `AND (age_group  != '15-74')` to filter to totals only.
This column can link as foreign key to population if the age_group is '15-74'

values
- 15-24
- 25-34
- 35-44
- 45-54
- 55-64
- 65-74
- 15-74
# view macro.population

the population is for age group as whole from age 15-74

columns
- year: integer
- country: denmark, finland, norway, sweden
- population_type: individual or house hold
- population: unit thousand
# How to handle data
[FIX] the stacking section below duplicates info already in nordic-kpi_type.md under stacking. Move to kpi_type or remove from here?

## stacking
- Unit: average number of paid services per subscriber (e.g. 1.85 = holds ~2 services on average)
- Value range: 0–3.15
- category: online_video
- kpi_dimension: svod, ssvod, hvod
- population_segment: subscribers
- countries: all four
- years: 2013–2025

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
## Multi-country querying rules

### Quarter filter
When querying more than one country, always filter to Q1 and Q3. Including Q2/Q4 gives Sweden twice as many data points, producing misleading comparisons:
```sql
AND quarter IN (1, 3)  -- always add when querying more than one country
```
Sweden-only queries: all quarters available, no filter needed.

### Population weighting
When combining data from more than one country, always use population-weighted averages. A simple average across countries is incorrect because countries have different population sizes.
- reach, viewing_time — weight by individuals aged 15–74
- penetration, spend, churn_intention, stacking, account_sharing — weight by households aged 15–74

Population data is in `macro.fact_population`. Join on country + year (annual figures apply to all quarters in the same year).
```sql
SUM(value * population) / SUM(population) AS value_weighted
```
Single-country queries: no weighting needed — use AVG(value) with GROUP BY.

### Latest period per country
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
# general rule

- prefer using spline to get smooth chart
- for bar and column mark, never stack on top of each other with the same color


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
