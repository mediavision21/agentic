# nordic — semantic notes

## Table structure
Long-format KPI measurement table for Nordic media markets.
Derived from nordic_long_v2 with cleaned dimension values.
Each row = one data point for a unique combination of (country, quarter, kpi_type, kpi_dimension, age_group, population_segment).
The `value` column unit differs per kpi_type — NEVER aggregate or compare values across different kpi_types.

## Column values
- country: denmark, finland, norway, sweden  (full names, not country codes)
- quarter: 1, 2, 3, 4  (integer, not q1/q2/q3/q4)
- category: cinema, dvd_blu_ray, online_video, tv, tvod

## kpi_type meanings
- reach / reach_weekly: % of population who used the service/medium in the past week
- reach_monthly: % of population who used the service/medium in the past month
- reach_service / reach_service_weekly: weekly reach for a specific service
- penetration / penetration_service: % of households or individuals subscribing
- spend / spend_service: ARPU (average revenue per user) or total consumer spending
- viewing_time / viewing_time_service: average hours viewed per week per user
- churn_intention: % of subscribers intending to cancel
- churn_intention_service: churn intention for a specific service
- gross_access / gross_access_service: absolute subscriber or user count
- stacking: average number of paid services per subscriber
- account_sharing: % of accounts being shared

## _service suffix rule
kpi_types ending in `_service` measure a single streaming service.
Non-_service kpi_types measure the market segment as a whole.

## kpi_dimension meanings
- svod: subscription video on demand (paid streaming)
- avod: ad-supported video on demand (free streaming with ads)
- ssvod: single-service svod (standalone subscriptions)
- bsvod: bundled svod (streaming included in a bundle)
- hvod: hybrid VOD
- ott: all online video combined (svod + avod + tvod)
- fta: free-to-air television (broadcast TV)
- tve: TV everywhere (broadcaster catch-up/live streaming apps)
- pay_tv_channel: traditional pay TV channels
- public_service: public broadcaster services (NRK, DR, SVT, YLE)
- social: social media video (YouTube, TikTok, Facebook, Instagram)
- online_total: all online including social
- online_excluding_social: online video excluding social media
- fast: free ad-supported streaming TV (linear channels online)
- ads_ott: ad-supported OTT

## Querying guidelines
1. ALWAYS filter kpi_type to exactly one value.
2. ALWAYS filter kpi_dimension unless explicitly comparing segments.
3. Use quarter (integer 1-4) for time filtering within a year.
4. country values are full names: denmark, finland, norway, sweden.
