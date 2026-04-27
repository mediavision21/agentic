# Mediavision — Query Intent Resolution Skill

## Purpose

This skill governs how to resolve an ambiguous or underspecified user question into a
fully-specified, executable SQL query against `macro.nordic_long_v2`. The goal is
**always generate meaningful SQL** — never block or ask a clarifying question when a
sensible default exists. Offer the user a small set of follow-on options *after* showing
results, not before.
## Step 0 - NOT filter column

- population_segment is just a tag, we DO NOT need to filter it

## Step 1 — Resolve `kpi_type`

`kpi_type` is the most important column. Every other dimension depends on knowing it.

### 1a — User states a kpi_type explicitly

Map natural language to the canonical value:

| User says | `kpi_type` |
|---|---|
| reach, viewers, who watched, daily reach | `reach` |
| penetration, subscribers, how many subscribe, subscription rate | `penetration`|
| spend, spending, ARPU, how much do people pay | `spend`|
| viewing time, how long, minutes, time spent | `viewing_time`|
| churn, cancel, cancellation intention | `churn_intention`|
| stacking, how many services, number of subscriptions | `stacking` |
| account sharing, sharing | `account_sharing` |
| gross access | `gross_access`|


### 1b — User does NOT state a kpi_type

Apply this priority order based on what the user's question implies:

1. Question mentions a **specific service by name** → default `kpi_type = penetration_service`
   (most commonly what analysts want for a named service)
2. Question asks about **"top services"** without a metric → default `penetration_service`
3. Question asks about **"reach"** of a category or platform → `reach` / `reach_service`
4. Question is a **general overview** with no hints → default `penetration_service`
   with `kpi_dimension = svod`

Always state the assumed kpi_type in the response preamble.

## Step 2 — Resolve `kpi_dimension`

Given the resolved `kpi_type`, apply these defaults. Only deviate if the user explicitly
names a dimension.

| `kpi_type` | Default `kpi_dimension` | Notes |
|---|---|---|
| `penetration` | `svod` | Most common market-level penetration question |
| `penetration_service` | `svod` | Standard service-level subscription view |
| `reach` | `online_total` | Includes social + streaming |
| `reach_service` | *(empty)* | Service reach has no sub-dimension |
| `viewing_time` | *(empty)* | Total viewing time |
| `viewing_time_service` | *(empty)* | Per-service viewing time |
| `spend` | `ssvod` | Standalone SVOD spend is the primary tracked metric |
| `spend_service` | *(empty)* | Per-service spend |
| `churn_intention` | `svod` | Churn among SVOD subscribers |
| `churn_intention_service` | *(empty)* | Per-service churn |
| `stacking` | `svod` | Number of SVOD services |
| `account_sharing` | *(empty)* | No sub-dimension |
| `gross_access` | `svod` | Standard gross access question |

### Reverse lookup — user states a `kpi_dimension` without `kpi_type`

If the user mentions a dimension keyword, infer the kpi_type:

| User says / dimension keyword | Inferred `kpi_type` |
|---|---|
| svod, s-svod, b-svod, hvod, subscription | `penetration` |
| social, online total, online excluding social | `reach` |
| public service | `reach` |
| genre (drama, sports, etc.) | `reach` with `kpi_dimension = genre`, `kpi_detail` = specific genre |
| avod, fast, ads-ott | `penetration` or `reach` depending on context |
| fta, free-to-air | `reach` with `category = tv` |

## Step 3 — Resolve `category`

Default: `online_video` unless the question contains a clear signal:

| Signal in question | `category` |
|---|---|
| TV, linear TV, broadcast, free-to-air | `tv` |
| radio | `radio` |
| podcast | `podcast` |
| music, Spotify | `music` |
| cinema, movies in cinema | `cinema` |
| streaming, Netflix, YouTube, SVOD, online video | `online_video` |
| *(no signal)* | `online_video` |

## Step 4 — Resolve geography (`country`)

Default: **all four countries, population-weighted Nordic average**.

| User says | Filter |
|---|---|
| Sweden / Swedish / Sverige | `country = 'sweden'` — all four quarters available |
| Norway / Norwegian / Norge | `country = 'norway'` — Q1 and Q3 only |
| Denmark / Danish / Danmark | `country = 'denmark'` — Q1 and Q3 only |
| Finland / Finnish / Finland | `country = 'finland'` — Q1 and Q3 only |
| Nordic, Nordics, all countries, *(no mention)* | All four countries, add `AND quarter IN ('q1','q3')` |
| Two or more countries | Add `AND quarter IN ('q1','q3')` always |

**Critical rule:** When querying more than one country, ALWAYS add `AND quarter IN ('q1','q3')`.
Never use a global `MAX(period_sort)` across countries — always get the latest period per
country individually.

---

## Step 5 — Resolve time period

Default: **latest available shared period vs. same period one year prior**.

```sql
-- Get latest period available across all selected countries (q1/q3 only)
WITH latest AS (
    SELECT l.country, MAX(p.period_sort) AS latest_sort
    FROM macro.nordic_long_v2 l
    JOIN macro.dim_period p ON l.year = p.year AND l.quarter = p.quarter
    WHERE l.quarter IN ('q1','q3')
      -- AND l.country IN (...) if country-filtered
    GROUP BY l.country
),
shared_latest AS (
    SELECT MIN(latest_sort) AS period_sort FROM latest  -- lowest common denominator
)
```

For trend queries ("over time", "trend", "historical"), show the last 6 available
Q1/Q3 periods (3 years of comparable data).

| User says | Period logic |
|---|---|
| *(nothing)* | Latest shared period + year-ago comparison |
| trend, over time, historical, development | Last 6 Q1/Q3 periods |
| last year, 2024 | Filter `year = '2024'` |
| Q3 2024, Fall 2024 | Filter `year = '2024' AND quarter = 'q3'` |
| last quarter | Latest available period per country |

---

## Step 6 — Resolve service filter

If a specific service is named, look up its `service_id`:

| Common name | `service_id` |
|---|---|
| Netflix | `netflix` |
| HBO Max / Max | `hbo_max` |
| Disney+ | `disney` |
| Viaplay | `viaplay` |
| Prime Video / Amazon | `prime` |
| YouTube | `youtube` |
| TikTok | `tiktok` |
| Instagram | `instagram` |
| TV4 Play / TV4 | `tv4_play` |
| SVT Play | `svt_play` |
| NRK | `nrk` |
| TV 2 Play (Norway) | `tv2_play_no` |
| Discovery+ | `discovery` |
| SkyShowtime | `skyshowtime` |

For "top N services" queries: use `kpi_type = penetration_service` (or the resolved type),
no `service_id` filter, rank by value in the latest period, return top 5 by default,
cap at 15.

For service-category filters (e.g. "streaming services only", "social media only"):
join `macro.dim_service` and filter on boolean flags:
- `is_streaming_service = true`
- `is_social_video = true`
- `is_public_service = true`
- `is_avod = true`
- `is_fast = true`

---

## Step 7 — Resolve population weighting

This is determined by `kpi_type`, not by user input. Never ask the user about this.

| `kpi_type` | Weight by | `population_type` |
|---|---|---|
| reach, reach_service, viewing_time, viewing_time_service | individuals | `'individuals'` |
| penetration, penetration_service, spend, spend_service, churn_intention, churn_intention_service, stacking, account_sharing, gross_access, gross_access_service | households | `'households'` |

Always use `NULLIF(SUM(population), 0)` to guard against division by zero.

---

## Step 8 — Resolve optional filters

Apply these defaults silently:

| Column | Default when not specified |
|---|---|
| `age_group` | `age_group = '15-74' — total population |
| `kpi_detail` | `(kpi_detail IS NULL OR kpi_detail = '')` — unless genre is specified |


**Exception:** `viewing_time_service` queries should filter `population_segment = 'viewers'`
by default — this is the meaningful interpretation (minutes per viewer, not averaged
across all population).

---

## Step 9 — Currency handling (spend queries)

For single-country spend: return local currency (SEK, NOK, DKK, EUR).
For multi-country spend comparison: always convert to EUR via `macro.fact_fx_rate_quarterly`.

```sql
JOIN macro.fact_fx_rate_quarterly fx
  ON fx.period_key = l.period_key AND fx.currency_code = <country_currency>
-- Then: l.value * fx.rate_to_eur AS value_eur
```

State the currency in the response.

---

## SQL generation rules (mandatory)

3. **Never use raw value column for display** — multiply proportions × 100.
4. **Never use global `MAX(period_sort)`** across all countries. Always per-country.
5. **Always add `AND quarter IN ('q1','q3')`** when querying more than one country.
6. **Always filter `age_group = '15-74'`** unless age breakdown is requested.
7. **Always use `NULLIF(..., 0)`** in population-weighted divisions.
8. **Service ranking pattern**: rank by value in the latest period FIRST, then cross-join
   top services × all periods to ensure all services appear in every period.

---

## Post-query: offer follow-on options

After showing results, always offer 2–3 follow-on options that are meaningfully different.
Frame them as buttons or quick suggestions. Examples:

- "Break this down by country"
- "Show the trend over the last 3 years"
- "Compare by service type (SVOD vs HVOD vs social)"
- "Show the same metric for a specific country"
- "Add age group breakdown" (only for reach / viewing_time)
- "Switch to [related kpi_type]" e.g. from penetration to reach

---

## Response preamble template

Always open with a one-sentence summary of what defaults were applied:

> "Showing [kpi_type display name] for [country/Nordic average], [period], [dimension if non-obvious], using population-weighted average."

Example:
> "Showing SVOD penetration per service — population-weighted Nordic average, Q3 2025 vs Q3 2024, total population."

---

## Full worked example: "Top five services side by side?"

**Resolution:**
- `kpi_type` → not stated → default `penetration_service`
- `kpi_dimension` → default for `penetration_service` → `svod`
- `category` → default `online_video`
- `country` → not stated → all four, `quarter IN ('q1','q3')`
- `period` → latest shared + year-ago
- `service_id` → not stated → top 5 by penetration in latest period
- `age_group` → total population
- `population_segment` → general population
- `population weight` → households (penetration is household-level)

**Generated preamble:**
> "Showing SVOD penetration for the top 5 services — population-weighted Nordic average, Q3 2025 vs Q3 2024."

**Follow-on options offered:**
1. Break this down by country
2. Show the trend over the last 3 years
3. Switch to reach instead of penetration
4. Show all services (top 15)

---

## What NOT to do

- Never block on a missing filter when a default exists.
- Never ask "which country?" — default to Nordic and state it.
- Never ask "which time period?" — default to latest and state it.
- Never ask "which category?" — default to online_video and state it.
- Only ask a clarifying question when `kpi_type` is genuinely unresolvable from context
  AND no default interpretation would be meaningful. Even then, proceed with the most
  likely default and flag it as an assumption.
- Never display raw decimals — always multiply proportions by 100 for display.
- Never average across countries without population weighting.