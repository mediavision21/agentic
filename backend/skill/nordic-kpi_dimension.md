
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
