
## Supporting tables (macro schema)

| table                   | purpose                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `dim_period`            | maps (year, quarter) to display labels and sortable `period_sort` int, e.g. `20241` = Q1 2024            |
| `dim_service`           | maps `service_id` to `canonical_name` + flags: `is_streaming_service`, `is_avod`, `is_fast`, `is_public_service`, `is_social_video` |
| `dim_country`           | maps country codes to display labels                                                                      |
| `fact_population`       | DEPRECATED — population is already a column on `macro.nordic`. Do not use. |
| `fact_fx_rate_quarterly`| FX rates per quarter — join on `period_key` and `currency_code`, multiply `value * rate_to_eur`          |
| `insight_text`          | editorial commentary rows — use as context alongside numeric KPI data                                     |

