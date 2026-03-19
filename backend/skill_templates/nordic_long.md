# nordic_long_v2 — semantic notes

## Table structure
Long-format KPI measurement table for Nordic media markets (DK, FI, NO, SE).
Each row = one data point for a unique combination of (country, period, kpi_type, kpi_dimension, kpi_detail, service_id).
The `value` column unit differs per kpi_type — NEVER aggregate or compare values across different kpi_types.

## kpi_type meanings
- reach / reach_weekly: % of population who used the service/medium in the past week
- reach_monthly: % of population who used the service/medium in the past month
- reach_service / reach_service_weekly: weekly reach for a specific service — requires service_id filter
- penetration / penetration_service: % of households or individuals subscribing
- spend / spend_service: ARPU (average revenue per user) or total consumer spending
- viewing_time / viewing_time_service: average hours viewed per week per user
- churn_intention: % of subscribers intending to cancel
- churn_intention_service: churn intention for a specific service — requires service_id filter
- gross_access / gross_access_service: absolute subscriber or user count
- stacking: average number of paid services per subscriber
- account_sharing: % of accounts being shared

## _service suffix rule
kpi_types ending in `_service` measure a single streaming service.
These MUST be combined with a `service_id` filter (e.g. service_id='netflix').
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
- genre: breakdown by content genre — use with kpi_detail
- illegal_iptv: illegal IPTV usage
- fast: free ad-supported streaming TV (linear channels online)
- ads_ott: ad-supported OTT

## kpi_detail meanings (genre breakdown)
Only populated when kpi_dimension='genre'.
Values: drama_local, drama_foreign, drama_total, sports_local, sports_foreign, sports_total, film_local, film_foreign, entertainment_local, entertainment_foreign, factual_documentary, family_kids, news_debate, music, etc.

## Querying guidelines
1. ALWAYS filter kpi_type to exactly one value.
2. ALWAYS filter kpi_dimension unless explicitly comparing segments.
3. Filter kpi_detail='' (empty string) unless the question is about genres.
4. Use service_id filter when kpi_type ends in _service or user asks about a specific service.
5. Use period_key (format: '2023q1') or year for time filtering.
6. Valid period_key range starts from 2005q2.
