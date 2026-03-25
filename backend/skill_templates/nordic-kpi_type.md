## kpi_type
its a sub type of category

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
- '' (empty) + subscribers: average monthly ARPU for pay TV or SVOD subscribers
- ssvod + subscribers: average monthly spend on standalone SVOD subscriptions
- '' (empty) + users: average monthly consumer spend (cinema tickets, DVD, TVOD rentals)


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
