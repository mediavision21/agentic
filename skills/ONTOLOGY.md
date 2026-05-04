# Mediavision Data Ontology

Authoritative reference for interpreting user questions, resolving intent, and generating SQL against the Mediavision Supabase database (`macro` schema).

Read this before generating any SQL.

---

## 1. The Query Target: `macro.nordic`

**Always query `macro.nordic`.** It is a materialized view that is the single source of truth for all KPI data. The underlying raw table is `nordic_long_v2` — the agent does not need to know its structure and must never query it directly.

Values are **never additive across rows**. Never `SUM()` penetration, reach, churn, or similar figures across services or dimensions. The only valid multi-row aggregation is population-weighted averaging across countries.

---

## 2. Column Reference

| Column | Type | Description |
|---|---|---|
| `period_date` | `DATE` | First day of the survey quarter: Jan 1, Apr 1, Jul 1, Oct 1 |
| `country` | `text` | `'sweden'`, `'norway'`, `'denmark'`, `'finland'` |
| `service_id` | `text` | Service identifier — `NULL` on market-level rows. service_id is mutually exclusive with kpi_dimension |
| `kpi_type` | `text` | The KPI being measured — see Section 5 |
| `kpi_dimension` | `text` | Sub-type of the KPI — `NULL` when not applicable |
| `kpi_detail` | `text` | detail only for Genre — `NULL` when not applicable |
| `age_group` | `text` | Age bracket — always `'15-74'` for total population, never empty |
| `population_segment` | `text` | Sub-population filter — `NULL` means general population |
| `value` | `numeric` | The KPI value — units depend on `kpi_type` |
| `is_social_video` | `boolean` | `true` for social platforms — `NULL` on market-level rows |
| `is_streaming_service` | `boolean` | `true` for SVOD/streaming platforms — `NULL` on market-level rows |
| `is_avod` | `boolean` | `true` for AVOD-only services — `NULL` on market-level rows |
| `is_fast` | `boolean` | `true` for FAST services — `NULL` on market-level rows |
| `is_public_service` | `boolean` | `true` for public broadcasters — `NULL` on market-level rows |
| `population` | `numeric` | Individuals for this row's specific `age_group` and country/year |
| `population_1574` | `numeric` | Total individuals aged 15–74 for country/year — use for cross-age-group weighting |
| `population_household` | `numeric` | Total households aged 15–74 for country/year |

---

## 3. Resolution Model

Every user question resolves to **one of two patterns**:

| Pattern | When to use | Key filter |
|---|---|---|
| `kpi_type` + `kpi_dimension` | Market-level — no specific service named | `service_id IS NULL` |
| `kpi_type` + `service_id` | Service-specific — a named platform or operator | `service_id = '<id>'` |

If both a dimension and a service are implied by the question, ask user further question to clarify. 
The sql to query shall using either dimension or service not both at the same time.

---

## 5. KPI Types (`kpi_type`)

### 5.1 Full reference

| `kpi_type` | Meaning | Unit | Population weight |
|---|---|---|---|
| `reach` | Daily reach — % of population who consumed yesterday | Proportion → display as % | `population_1574` |
| `reach_monthly` | Monthly reach | Proportion → display as % | `population_1574` |
| `reach_weekly` | Weekly reach (market or per-service; Sweden-heavy) | Proportion → display as % | `population_1574` |
| `penetration` | % of households with a subscription or access | Proportion → display as % | `population_household` |
| `gross_access` | Gross access incl. account sharing (service), or intent to subscribe (market) | Proportion → display as % | `population_household` |
| `viewing_time` | Average minutes per day | Minutes | `population_1574` |
| `spend` | Average monthly household spend in local currency | Currency | `population_household` |
| `stacking` | Average number of SVOD services per household | Decimal | `population_household` |
| `churn_intention` | % of subscribers intending to cancel | Proportion → display as % | `population_household` |
| `account_sharing` | % sharing or planning to share an account | Proportion → display as % | `population_household` |

### 5.2 Market-level vs per-service

The same `kpi_type` value covers both market-level and per-service rows. The distinction is made by `service_id`:
market_level: kpi_type + kpi_dimension, service_id is NULL
per-service: kpi_type + service_id, kpi_dimension is NULL

| User intent | `kpi_type` | `service_id` |
|---|---|---|
| SVOD penetration (market) | `penetration` | `IS NULL` |
| Netflix penetration (service) | `penetration` | `= 'netflix'` |
| Overall SVOD reach (market) | `reach` | `IS NULL` |
| Netflix daily reach (service) | `reach` | `= 'netflix'` |
| Market-level churn intent | `churn_intention` | `IS NULL` |
| Churn intent for Viaplay | `churn_intention` | `= 'viaplay'` |

This pattern applies to: `penetration`, `reach`, `reach_weekly`, `gross_access`, `viewing_time`, `spend`, `churn_intention`.

### 5.3 Value display rules

| Unit | Raw storage | Display |
|---|---|---|
| Proportions | `0.0`–`1.0` decimal | Multiply × 100 → show as `%` |
| Viewing time | Minutes/day | Show as minutes, no transform |
| Spend | Local currency/month | Show as-is; use `macro.fact_fx_rate_quarterly` to convert to EUR for cross-country comparisons |
| Stacking | Decimal count | Show as-is (e.g. `1.85 services`) |

**Never display raw proportion decimals to users.**

---

## 6. KPI Dimensions (`kpi_dimension`)

Narrows what a market-level KPI measures. `NULL` means the full category with no sub-type.

### 6.1 Subscription model

| `kpi_dimension` | Meaning | Typical `kpi_type` pairings |
|---|---|---|
| `'svod'` | All SVOD combined (standalone + bundled) | `penetration`, `reach`, `stacking`, `churn_intention`, `account_sharing`, `gross_access` |
| `'ssvod'` | Standalone/self-paying SVOD — D2C, no operator bundle | `penetration`, `reach`, `viewing_time`, `spend`, `stacking`, `account_sharing` |
| `'bsvod'` | Bundled SVOD — included via telco or employer | `penetration`, `reach`, `viewing_time` |
| `'hvod'` | Hybrid VOD — ad-supported tier within a SVOD service | `penetration`, `reach`, `viewing_time`, `stacking` |
| `'tve'` | TV Everywhere — operator streaming app, no proprietary content library | `penetration` |
| `'ott'` | Any OTT service (broadest definition) | `penetration` |

### 6.2 Online video types

| `kpi_dimension` | Meaning | Typical `kpi_type` pairings |
|---|---|---|
| `'online_total'` | All online video including social media | `reach`, `reach_weekly` |
| `'online_excluding_social'` | Online video excluding social platforms | `reach`, `viewing_time` |
| `'social'` | Social media video (TikTok, Instagram, Facebook, Snapchat) | `reach`, `viewing_time` |
| `'public_service'` | Public service broadcasters (NRK, SVT, DR, YLE) | `reach` |
| `'avod'` | Ad-supported VOD excluding social | `reach`, `viewing_time` |
| `'ads_ott'` | Ad-supported OTT (AVOD + HVOD combined) | `reach` |
| `'fast'` | Free Ad-Supported Streaming TV (Pluto TV, Samsung TV+, etc.) | `reach` |
| `'old_online_total'` | Legacy metric — historical data only, avoid for current analysis | `viewing_time` |

### 6.3 Pay TV and broadcast

| `kpi_dimension` | Meaning | Typical `kpi_type` pairings |
|---|---|---|
| `'pay_tv_channel'` | Traditional pay TV channel packages | `penetration` |
| `'fta'` | Free-to-air TV | `penetration` |
| `'illegal_iptv'` | Illegal IPTV access | `penetration` |

### 6.4 Genre

| `kpi_dimension` | Note |
|---|---|
| `'genre'` | Always add a `kpi_detail` filter for the specific genre. |

### 6.5 Valid `kpi_type` + `kpi_dimension` combinations

Only these combinations exist in the data. Do not construct others.

| `kpi_type` | Valid `kpi_dimension` values |
|---|---|
| `account_sharing` | `ssvod`, `svod` |
| `churn_intention` | `svod` |
| `gross_access` | `svod` |
| `penetration` | `bsvod`, `fta`, `hvod`, `illegal_iptv`, `ott`, `pay_tv_channel`, `ssvod`, `svod`, `tve` |
| `reach` | `ads_ott`, `avod`, `bsvod`, `fast`, `genre`, `hvod`, `online_excluding_social`, `online_total`, `public_service`, `social`, `ssvod`, `svod` |
| `reach_weekly` | `online_total` |
| `spend` | `ssvod` |
| `stacking` | `hvod`, `ssvod`, `svod` |
| `viewing_time` | `avod`, `bsvod`, `genre`, `hvod`, `old_online_total`, `online_excluding_social`, `social`, `ssvod` |

---

## 7. Genre Detail (`kpi_detail`)

Only populated when `kpi_dimension = 'genre'`. `NULL` in all other rows.

`kpi_detail` values:
- `drama_local` `drama_foreign` `drama_total`
- `film_local` `film_foreign`
- `tv_series_local` `tv_series_foreign`
- `sports_local` `sports_foreign` `sports_total`
- `entertainment_local` `entertainment_foreign` `entertainment_total`
- `family_kids` `news_debate` `factual_documentary` `gaming_esport`
- `music` `humor_clips` `animal_clips` `other`

---

## 8. Services (`service_id`)

### 8.1 Service columns

| Column | Description |
|---|---|
| `service_id` | Normalised identifier — consistent across all four countries. `NULL` on market-level rows. |
| `canonical_name` | Display name — always use this for output, never raw `service_id`. |
| `is_streaming_service` | `true` for SVOD/streaming platforms |
| `is_social_video` | `true` for TikTok, Instagram, Facebook, Snapchat |
| `is_avod` | `true` for AVOD-only services |
| `is_fast` | `true` for FAST services (Pluto TV, Samsung TV+, etc.) |
| `is_public_service` | `true` for NRK, SVT Play, DR, YLE Areena |

All service flag columns are `NULL` on market-level rows.

### 8.2 Querying service groups

Use boolean flags rather than listing individual service IDs:

```sql
WHERE is_streaming_service = true
WHERE is_social_video = true
WHERE is_public_service = true
WHERE is_fast = true
```

### 8.3 Valid `kpi_type` + `service_id` combinations

#### `churn_intention`
`allente`, `altibox`, `antenni_tv`, `boxer`, `dna`, `elisa`, `norlys`, `riks_tv`, `tele2`, `telenor`, `telia`, `waoo`, `yousee`

#### `gross_access`
`allente_stream`, `apple_tv`, `bbc_nordic`, `britbox`, `cirkus_tv`, `cmore`, `dazn`, `direktesport`, `discovery`, `disney`, `dk4`, `draken_film`, `eurosport`, `f1tv`, `golf_tv`, `hayu`, `hbo_max`, `lionsgate`, `mtv_katsomo`, `netflix`, `nordisk_film`, `other`, `prime`, `ruutu`, `skyshowtime`, `staccs`, `tele2_play`, `tennis_tv`, `tv2_play_dk`, `tv2_play_no`, `tv4_play`, `viaplay`, `yousee_play`, `youtube`

#### `penetration`
`allente`, `boxer`, `other`, `tele2`, `telenor`, `telia`, `unknown`, `viasat`

#### `reach`
`aaumalehti_sanomat`, `aftenposten`, `aftonbladet`, `apple_tv`, `bbc_nordic`, `cmore`, `dagbladet`, `dazn`, `direktesport`, `discovery`, `disney`, `dr`, `ekstrabladet`, `eurosport`, `expressen`, `facebook`, `hayu`, `hbo_max`, `helsingin_sanomat`, `ilta_sanomat`, `iltalehti`, `instagram`, `mtv_katsomo`, `netflix`, `nordisk_film`, `nrk`, `pluto_tv`, `prime`, `rakuten_tv`, `ruutu`, `ruutu_netti`, `samsung_tv`, `skyshowtime`, `snapchat`, `svt_play`, `tele2_play`, `tiktok`, `tv2_play_dk`, `tv2_play_no`, `tv4_play`, `twitch`, `ur_play`, `vg`, `viafree`, `viaplay`, `yle_areena`, `youtube`

#### `reach_weekly`
`aftonbladet`, `allente_stream`, `apple_tv`, `dazn`, `discovery`, `disney`, `eurosport`, `expressen`, `facebook`, `hayu`, `hbo_max`, `instagram`, `netflix`, `other`, `pluto_tv`, `prime`, `rakuten_tv`, `samsung_tv`, `skyshowtime`, `snapchat`, `svt_play`, `tele2_play`, `telenor_stream`, `telia_play`, `tiktok`, `tv4_play`, `twitch`, `ur_play`, `viaplay`, `youtube`

reach_weekly only exist for sweden

#### `spend`
`allente`, `altibox`, `antenni_tv`, `boxer`, `dna`, `elisa`, `nextgen_tel`, `norlys`, `other`, `riks_tv`, `tele2`, `telenor`, `telia`, `viasat`, `waoo`, `yousee`

#### `viewing_time`
`aaumalehti_sanomat`, `aftenposten`, `aftonbladet`, `apple_tv`, `bbc_nordic`, `cmore`, `dagbladet`, `dazn`, `direktesport`, `discovery`, `disney`, `dr`, `ekstrabladet`, `eurosport`, `expressen`, `facebook`, `hayu`, `hbo_max`, `helsingin_sanomat`, `ilta_sanomat`, `iltalehti`, `instagram`, `mtv_katsomo`, `netflix`, `nordisk_film`, `nrk`, `pluto_tv`, `prime`, `rakuten_tv`, `ruutu`, `ruutu_netti`, `samsung_tv`, `skyshowtime`, `snapchat`, `svt_play`, `tele2_play`, `tiktok`, `tv2_play_dk`, `tv2_play_no`, `tv4_play`, `twitch`, `ur_play`, `vg`, `viafree`, `viaplay`, `yle_areena`, `youtube`

---

## 9. Population Segments (`population_segment`)

population_segment is addon information. not for filter. 
There is no duplicate population_segment the same measure. no filter on query is needed
`NULL` means general population — the correct default for most queries.

| `population_segment` | Meaning |
|---|---|
| `NULL` | General population — all respondents |
| `'viewers'` | Only people who watched — use with `viewing_time` for per-viewer minutes (not per-capita) |
| `'subscribers'` | Only current subscribers |
| `'users'` | People who used the service, including free users |
| `'genre_viewers'` | Only people who watched a specific genre — use with `kpi_dimension = 'genre'` |

**Important:** NEVER filter based on population_segment, it is just as one extra meta data to say what the value's population is.
**Important:** `viewing_time` without `population_segment = 'viewers'` is minutes-per-capita across the whole population. With it, it is minutes-per-day among actual watchers. These are very different numbers — clarify which is needed before querying.

---

## 10. Age Groups (`age_group`)

`age_group` is never empty or `NULL` in `macro.nordic` — total population rows use `'15-74'`.

| `age_group` | Note |
|---|---|
| `'15-74'` | Total population — the default for most queries |
| `'15-24'`, `'25-34'`, `'35-44'`, `'45-54'`, `'55-64'`, `'65-74'` | Age sub-groups — available for `reach` and `viewing_time` only |

Age splits are **not available** for `penetration`, `spend`, or `stacking`.

When querying a specific age bracket, weight by `population` (age-group-specific count). When aggregating across age brackets, normalise using `population_1574`.

---

## 11. Period Filtering

`period_date` is a `DATE`. Use standard SQL date comparisons.

```sql
-- Latest period available
WHERE period_date = (SELECT MAX(period_date) FROM macro.nordic)

-- Specific quarter
WHERE period_date = '2025-01-01'   -- Q1 2025
WHERE period_date = '2025-07-01'   -- Q3 2025

-- Date range
WHERE period_date BETWEEN '2023-01-01' AND '2025-07-01'

-- Last two years
WHERE period_date >= CURRENT_DATE - INTERVAL '2 years'
```

Quarter → month mapping:

| Quarter | Month in `period_date` |
|---|---|
| Q1 | January (`01`) |
| Q2 | April (`04`) |
| Q3 | July (`07`) |
| Q4 | October (`10`) |

Data coverage starts from 2013.

---

## 12. Countries and the Multi-Country Rule

| `country` | Available quarters |
|---|---|
| `'sweden'` | Q1, Q2, Q3, Q4 |
| `'norway'` | Q1, Q3 only |
| `'denmark'` | Q1, Q3 only |
| `'finland'` | Q1, Q3 only |

**Critical:** When querying more than one country, always restrict to Q1 and Q3:

```sql
AND EXTRACT(MONTH FROM period_date) IN (1, 7)
```

Without this, Sweden contributes twice as many data points as the others, skewing any aggregation.

---

## 13. Aggregation and Weighting

### Choosing the right population column

| `kpi_type` | Weight column |
|---|---|
| `reach`, `reach_monthly`, `reach_weekly`, `viewing_time` | `population_1574` (when `age_group = '15-74'`); `population` (when filtering a specific age bracket) |
| `penetration`, `gross_access`, `spend`, `stacking`, `churn_intention`, `account_sharing` | `population_household` |

### Nordic weighted average pattern

```sql
-- Household KPI
SUM(value * population_household) / SUM(population_household)

-- Individual KPI
SUM(value * population_1574) / SUM(population_1574)
```

Never use `AVG()` across countries. Never use `SUM(value)` across services or dimensions.

---

## 14. Qualitative Context: `macro.insight_text`

Analyst commentary from quarterly reports. Surface alongside numeric results when relevant.

| Column | Description |
|---|---|
| `report_period` | Period the comment refers to |
| `country` | Country |
| `category` | Media category |
| `kpi_type` | KPI type |
| `kpi_dimension` | Dimension |
| `slide_title` | Report slide the comment came from |
| `comment_text` | Analyst commentary — safe to display to users |
| `comment_type` | `observation`, `driver`, or `context` |

---

## 15. Intent Resolution Guide

| User says | `kpi_type` | `kpi_dimension` | `service_id` |
|---|---|---|---|
| "SVOD penetration / subscription rate" | `penetration` | `svod` | `IS NULL` |
| "Standalone streaming penetration" | `penetration` | `ssvod` | `IS NULL` |
| "Bundled streaming penetration" | `penetration` | `bsvod` | `IS NULL` |
| "How many subscribe to Netflix / Disney+ / etc." | `penetration` | — | named service |
| "Pay TV / operator home penetration" | `penetration` | `pay_tv_channel` | `IS NULL` |
| "Illegal streaming / piracy" | `penetration` | `illegal_iptv` | `IS NULL` |
| "TVE / operator app penetration" | `penetration` | `tve` | `IS NULL` |
| "Daily reach of SVOD" | `reach` | `svod` | `IS NULL` |
| "Daily reach of Netflix / YouTube / etc." | `reach` | — | named service |
| "Social media reach" | `reach` | `social` | `IS NULL` |
| "TikTok / Instagram reach" | `reach` | — | `tiktok` / `instagram` |
| "Total online video reach" | `reach` | `online_total` | `IS NULL` |
| "Online video reach excl. social" | `reach` | `online_excluding_social` | `IS NULL` |
| "Public service reach" | `reach` | `public_service` | `IS NULL` or `nrk` / `svt_play` |
| "SVT reach" | `reach` | `IS NULL` | `= 'svt_play'` |
| "FAST / Pluto TV reach" | `reach` | `fast` | `IS NULL` |
| "Genre viewership" | `reach` | `genre` | `IS NULL` — also add `kpi_detail`  |
| "Time spent on Netflix / TikTok" | `viewing_time` | — | named service  |
| "SVOD / standalone viewing time" | `viewing_time` | `ssvod` | `IS NULL` |
| "Social video time spent" | `viewing_time` | `social` | `IS NULL` |
| "Monthly spend on streaming" | `spend` | `ssvod` | `IS NULL` |
| "Operator / pay TV monthly bill" | `spend` | — | operator `service_id` |
| "Number of services / stacking" | `stacking` | `svod` | `IS NULL` |
| "Churn / cancellation intent (market)" | `churn_intention` | `svod` | `IS NULL` |
| "Churn for Netflix / Viaplay" | `churn_intention` | — | named service |
| "Account sharing" | `account_sharing` | `svod` or `ssvod` | `IS NULL` |
| "Gross access / access incl. sharing" | `gross_access` | — | named service |
| "Intent to subscribe" | `gross_access` | `svod` | `IS NULL` |
| "Weekly reach" | `reach_weekly` | `online_total` or — | `IS NULL` or named service |

---

## 16. SQL Templates

### Single country

```sql
SELECT
  period_date,
  ROUND(value * 100, 1) AS value
FROM macro.nordic
WHERE kpi_type           = 'penetration'
  AND kpi_dimension      = 'svod'
  AND service_id         IS NULL
  AND age_group          = '15-74'
  AND country            = 'sweden'
ORDER BY period_date;
```

### Nordic weighted average — household KPI

```sql
SELECT
  period_date,
  ROUND(SUM(value * population_household) / SUM(population_household) * 100, 1) AS value
FROM macro.nordic
WHERE kpi_type           = 'penetration'
  AND kpi_dimension      = 'svod'
  AND service_id         IS NULL
  AND age_group          = '15-74'
  AND EXTRACT(MONTH FROM period_date) IN (1, 7)
GROUP BY period_date
ORDER BY period_date;
```

### Nordic weighted average — individual KPI

```sql
SELECT
  period_date,
  SUM(value * population_1574) / SUM(population_1574) AS value
FROM macro.nordic
WHERE kpi_type           = 'reach'
  AND kpi_dimension      = 'svod'
  AND service_id         IS NULL
  AND age_group          = '15-74'
  AND EXTRACT(MONTH FROM period_date) IN (1, 7)
GROUP BY period_date
ORDER BY period_date;
```

### Per-service ranking at latest period

```sql
SELECT
  canonical_name,
  country,
  ROUND(value * 100, 1) AS value
FROM macro.nordic
WHERE kpi_type           = 'penetration'
  AND service_id         IS NOT NULL
  AND age_group          = '15-74'
  AND period_date        = (SELECT MAX(period_date) FROM macro.nordic)
ORDER BY value DESC;
```

### Service group query using boolean flags

```sql
SELECT
  canonical_name,
  ROUND(value * 100, 1) AS value
FROM macro.nordic
WHERE kpi_type           = 'reach'
  AND is_streaming_service = true
  AND age_group          = '15-74'
  AND period_date        = (SELECT MAX(period_date) FROM macro.nordic)
ORDER BY value DESC;
```

## 17. What NOT to Do

| ❌ Wrong | ✅ Correct |
|---|---|
| `SUM(value)` across services or dimensions | Population-weighted average only |
| `AVG(value)` across countries | `SUM(value * population_X) / SUM(population_X)` |
| Display `0.42` as-is | Multiply × 100 → display as `42%` |
| Skip the Q1/Q3 filter on multi-country queries | `EXTRACT(MONTH FROM period_date) IN (1, 7)` |
| `age_group IS NULL` or `age_group = ''` | `age_group = '15-74'` — it is never empty in this view |
| `kpi_dimension IS NULL OR kpi_dimension = ''` | `kpi_dimension IS NULL` — empty strings do not exist in this view |
| Use `canonical_name` as a filter | Filter on `service_id`; use `canonical_name` only for display |
| Use `service_id` in output | Use `canonical_name` for all user-facing output |
| Query any `kpi_type` + `kpi_dimension` combo not in Section 6.5 | Validate against the confirmed combinations list |
| Query any `kpi_type` + `service_id` combo not in Section 8.3 | Validate against the confirmed combinations list |
| SELECT `kpi_dimension` for a service-level query | Omit `kpi_dimension` from SELECT when `service_id` is specified; it is always NULL and causes fan-out rows |
| Leave `kpi_dimension` unfiltered in WHERE | Always filter to exactly one value: either `kpi_dimension IS NULL` (service queries) or `kpi_dimension = '<value>'` (market queries) |
| SELECT columns that are not needed for the plot | Only include columns that are categorical keys for grouping/color or the single `value` column — omit constant-value columns |

## SQL rules
  - Generate ONLY SELECT queries. Never INSERT, UPDATE, DELETE, DROP.
  - Use column names and types from the schema exactly.
  - `kpi_type = {}` MUST easy in the sql
  - the final SELECT MUST always include ALL of: `period_date`, `country`, `kpi_type`, `kpi_dimension`, `service_id`, `age_group`, `population_segment`, `value`. population_segment is an addon information, never as filter. 
  - At most TWO of `period_date`, `country`, `kpi_type`, `kpi_dimension`, `service_id`, `age_group` may have multiple distinct values across rows — e.g. period varies + country varies is OK; period + country + service_id all varying is not
  - PostgreSQL (Supabase) restrictions — strictly follow:
    - Never nest aggregate functions (e.g. `SUM(AVG(...))` is illegal). Use a subquery or CTE to compute the inner aggregate first.
    - Never use a window function directly inside an aggregate, or vice versa. Stage them in separate CTEs.
    - Never reference a column alias defined in the same SELECT in a WHERE or HAVING clause — repeat the expression or use a subquery.
    - Use `FILTER (WHERE ...)` instead of `CASE WHEN ... END` inside aggregates where possible.
    - Prefer CTEs (`WITH ...`) over deeply nested subqueries to keep aggregation stages flat and readable.
    - Never join any population / fact / dim table — use the columns already on every `macro.nordic` row (`population`, `population_1574`, `population_household`, `is_*` flags, `canonical_name`, `period_date`).
    - `ROUND(x, n)` requires `x` to be `numeric`. Cast the entire expression: `ROUND((expr)::numeric, 1)`. Do NOT cast only part of it.
    - When self-joining the view (e.g. `macro.nordic vt JOIN macro.nordic r`), every column in SELECT, GROUP BY, and ORDER BY must be prefixed with a table alias.

## Thinking Steps

- Whether the question is market level question or service level question. For **service-level** questions (a named service is specified via `service_id`): always add `kpi_dimension IS NULL` in WHERE — service rows never have a dimension. For **market-level** questions: pick exactly one `kpi_dimension` value and filter to it explicitly (e.g. `kpi_dimension = 'svod'`). Never leave `kpi_dimension` unfiltered.
- Which kpi_type is the user in refer to, pick one is most relevant. then say so in the summary.
- Which country is the user is asking, pick either one country by add `country = {country}`. otherwise no extra filter indicate nordic
- Which quarters is the user is asking, if it the country is sweden only, then we can use all 4 quarters, otherwise, add `EXTRACT(MONTH FROM period_date) IN (1, 7)`
- Which years is the user is asking QoQ, YoY, or some past history
- What age_group is the user is asking, if without clear specify add filter `age_group = '15-74'` otherwise add explict age group filter.
- `population_segment` is NEVER a filter. It is metadata that travels with every row. Do not add `WHERE population_segment = ...` or `AND population_segment IS NULL` — the correct rows already exist without filtering on it.

## Output

<!--suggestions
  Option text 1
  Option text 2
  -->

  Each line inside the block becomes a clickable button the user can tap instead of typing.

  - When you have returned data rows, append key takeaways (3-5 short bullet strings) when the data shows clear trends, comparisons, or seasonal patterns. Omit when data is too simple or sparse.

  <!--key-takeaways
  Takeaway 1
  Takeaway 2
  -->

  Each line becomes a bullet point shown below the chart.

format: long/tidy (required for Observable Plot)

  Return **long/tidy data only**:
  - One row per observation
  - Must include exactly ONE numeric column, named `value`
  - The result value shall be either absolute value or relative value, but not present at the same time to avoid confusion. e.g. YoY reach shall NOT together with absolute reach.
  - All categorical dimensions as separate key columns (e.g. `period_date`, `country`, `service`, `age_group`)
  - t
  **Never pivot to wide form.** No `CASE WHEN ... END` per-category columns — Observable Plot handles grouping and faceting client-side from the key columns.