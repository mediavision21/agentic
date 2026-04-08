# Observable Plot skill

## Core principle — insight over raw display

Think in 3 layers:
1. **Time** → always x-axis (`period_label`)
2. **Value/metric** → always y-axis (reach_pct, viewing_time, penetration, count, etc.)
3. **Context/category** → color/stroke (country, service, business_model)

Prefer derived signals when possible: growth trend (not just raw value), engagement rate, year-over-year delta. Use spline smoothing to reveal trends, not noise.

## bar mark

- shall NEVER stack a bar on top of another one

## Y-axis rule (CRITICAL)

- Y-axis MUST be the value/metric column — NEVER use year, period_sort, period_label, or any date/time column on Y
- Wrong: `y: "year"` — this makes a meaningless vertical year scale
- Right: `y: "reach_pct"`, `y: "viewing_time_minutes"`, `y: "penetration"`, `y: "value"`

## Percentage formatting rule

- When the metric is a ratio (reach_pct, penetration, household_penetration, share, etc.) and values are between 0 and 1, format the y-axis as percentage: `"y": {"label": "Reach %", "tickFormat": ".0%"}` or `".1%"` for one decimal
- This applies to any column whose name contains `pct`, `penetration`, `share`, or `reach` and whose values are ≤ 1
- Display "42%" not "0.42" — percentages are far more readable

## Period/time axis rules

- **Always use `period_label` for the x-axis** — never `year`, `quarter_label`, `period_sort`, or `period_date` directly
- `period_sort` is a numeric key (`YYYYQ` format, e.g. 20243 = Q3 2024) — use it only for sorting, never as axis value
- Extract ordered unique periods: `rows.slice().sort((a,b) => +a.period_sort - +b.period_sort).map(d => d.period_label)` (deduplicated)
- Cast numeric columns: `+d.reach_pct`, `+d.period_sort`

## Year-over-year comparison pattern

```js
var sortedPeriods = Array.from(new Set(rows.map(d => +d.period_sort))).sort((a,b) => b-a);
var latest = sortedPeriods[0];
var yearAgo = sortedPeriods.find(s =>
    Math.floor(s/10) === Math.floor(latest/10) - 1 && s%10 === latest%10
) || sortedPeriods[1];
var latestLabel  = rows.find(d => +d.period_sort === latest).period_label;
var yearAgoLabel = rows.find(d => +d.period_sort === yearAgo).period_label;
var subset = rows.filter(d => +d.period_sort === latest || +d.period_sort === yearAgo);
```

## Spline rule

- Always use `curve: "catmull-rom"` for `Plot.line()` — smooth spline reveals trends, jagged lines add visual noise
- In the config JSON, add `"curve": "catmull-rom"` to every `lineY` mark

## Chart type rules

- **Trend (multiple periods)** → `Plot.line()` with `curve: "catmull-rom"` + `Plot.dot()` marks, x = `period_label`, domain sorted by `period_sort`
- **Comparison (snapshot)** → `Plot.barY()` with x = `period_label`, use year-over-year subset
- **Ranking / "top N" / single-period comparison** → `Plot.barY()` with x = category column (e.g. `service_name`), y = metric. The frontend will sort bars by y-value descending automatically. Use this when the user asks "top services", "ranking", or compares categories in a single period.
- **Grouped comparison (top N per group)** → when data has a primary grouping (e.g. country) and a ranked secondary category (e.g. top 5 services), use `fx` = primary group, `x` = rank column (with `axis: null`), `fill` = category name for the legend. The rank column ensures uniform bar positioning across facets, while the category name appears in the color legend. Example: top 5 services per country → `fx: "country"`, `x: "rnk"`, `y: "penetration_pct"`, `fill: "canonical_name"`, `x: {axis: null}`. The SQL should include a rank column via `ROW_NUMBER() OVER (PARTITION BY group ORDER BY metric DESC) AS rnk`.
- **Multi-category trend** → `Plot.line()` with `stroke = categoryColumn`; always set `color: { legend: true }`
- **Faceted by service/genre/age_group** → use `fx` for facet, `x = period_label` with `axis: null`, `fill = period_label`
- **Single series** → no stroke needed

## Multi-series rule

When the result has a categorical column (country, service, business_model, reach_type, kpi_dimension, age_group, genre) alongside period values:
- For `Plot.line()`: set `stroke = "thatColumn"`
- For `Plot.barY()`: set `fill = "thatColumn"`
- Never omit it — doing so collapses all series into one

## Color conventions

Green palette (darkest = latest period, lightest = oldest):
```
["#1a5c38", "#2d8653", "#52b788", "#95d5b2", "#b7e4c7", "#d8f3dc"]
```

For multi-line trends with named categories, use fixed named colors when known:
- Social video: `#1a5c38`, Other online: `#52b788`, Total online: `#95d5b2`
- SVOD: `#1a5c38`, Pay TV: `#b83c26`, BSVOD: `#d4a017`

## Dense data (many services/facets)

When data has many services/facets and many periods, show only last 6 periods:
```js
var allPeriods = Array.from(new Set(rows.map(d => +d.period_sort))).sort((a,b) => a-b);
var shown = allPeriods.slice(-6);
var subset = rows.filter(d => shown.indexOf(+d.period_sort) !== -1);
```

## General rules

- Prefer `curve: "catmull-rom"` for smooth line charts
- Always `Plot.ruleY([0])` for bar charts
- For bar charts: `tip: true`, `insetLeft`/`insetRight` for spacing
- Width: `Math.max(700, periods.length * 60)` for trend charts; fixed width for comparisons
- `tickRotate: -45` and `marginBottom: 80` when many period labels on x-axis
- All x label shall be show if the x axis is not time related, for service, kpi_type, kpi_dimension, shall show all the labels
- Never use `year` as Y-axis for any chart — it produces meaningless vertical layout
