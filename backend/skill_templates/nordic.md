# nordic — semantic notes

## Table structure
Long-format KPI measurement table for Nordic media markets.
Each row = one measurement for one unique combination of (country, year, quarter, category, kpi_type, kpi_dimension, age_group, population_segment).
The `value` column unit differs per kpi_type — NEVER aggregate or compare values across different kpi_types.

## Column values
- country: denmark, finland, norway, sweden  (full names)
- quarter: 1, 2, 3, 4  (integer)
- category: cinema, dvd_blu_ray, online_video, tv, tvod

## kpi_type demographics

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
- To convert to EUR: multiply value by the EUR rate from fact_fx_rate_quarterly (match on country + year + quarter)
- Value range: ~8–418
- category: online_video, tv → population_segment: subscribers
            cinema, dvd_blu_ray, tvod → population_segment: users
- kpi_dimension: '' or ssvod
- countries: all four
- years: 2012–2025

### spend_service
- Unit: local currency per subscriber per month — SEK (sweden), NOK (norway), DKK (denmark), EUR (finland)
- To convert to EUR: multiply value by the EUR rate from fact_fx_rate_quarterly (match on country + year + quarter)
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

## NULL handling for optional columns
kpi_dimension, age_group and population_segment are NULL for most kpi_types.
- NEVER filter them with = '' — that returns 0 rows
- NEVER filter out age_group = '' or population_segment = '' unless intentional
- Only add a filter on these columns when the user explicitly asks for a specific age group or population segment
- If you must exclude nulls, use IS NOT NULL — but usually just omit the filter entirely
- return all those rows let observable plot group of filter those columns

## Querying guidelines
1. ALWAYS use table `macro.nordic`.
2. ALWAYS filter kpi_type to exactly one value.
3. Use year and quarter for time filtering — there is no period_key column.
4. Use the demographics above to pick the correct kpi_dimension and category for the kpi_type.
5. Only include WHERE clauses for columns that matter to the question — omit age_group and population_segment filters unless specifically asked.
6. When user asks about age groups, use reach or viewing_time and add age_group filter.
7. When user asks about a specific service, use the _service suffix kpi_type.
8. spend and viewing_time values are absolute numbers, not ratios — do not treat as percentages.
9. reach*, penetration*, churn*, account_sharing, gross_access* values are ratios — multiply by 100 to display as %.
10. stacking values are counts (avg services per subscriber).
