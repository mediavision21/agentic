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