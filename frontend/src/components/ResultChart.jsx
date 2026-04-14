import { useRef, useEffect, useState } from "react"
import * as Plot from "@observablehq/plot"
import { highlightJSON } from "../highlight.js"

// mark type → Plot function map
const MARK_FN = {
	lineY: Plot.lineY,
	barY: Plot.barY,
	dot: Plot.dot,
	areaY: Plot.areaY,
}

function isNumeric(val) {
	if (val == null) return false
	return !isNaN(Number(val))
}

function isDateLike(val) {
	if (val == null) return false
	const str = String(val)
	return /^\d{4}-\d{2}/.test(str) || !isNaN(Date.parse(str))
}

// convert row values for a mark — x/y to numbers, x to Date if date-like and lineY
function prepareData(options) {
	const { rows, columns, mark } = options
	return rows.map(function (row) {
		const d = {}
		for (const col of columns) {
			d[col] = row[col]
		}
		if (isDateLike(d[mark.x])) {
			d[mark.x] = new Date(d[mark.x])
		}
		if (isNumeric(d[mark.y])) {
			d[mark.y] = Number(d[mark.y])
		}
		if (isNumeric(d[mark.x]) && !isDateLike(rows[0][mark.x])) {
			d[mark.x] = Number(d[mark.x])
		}
		return d
	})
}

// LLM may return scheme as comma-separated hex string or array — normalize to range
function normalizeColorConfig(colorCfg) {
	if (!colorCfg) return colorCfg
	const out = { ...colorCfg }
	if (typeof out.scheme === "string" && out.scheme.includes("#")) {
		out.range = out.scheme.split(",").map(function (s) { return s.trim() })
		delete out.scheme
	}
	if (Array.isArray(out.scheme)) {
		out.range = out.scheme
		delete out.scheme
	}
	return out
}

// derive a sortable numeric key from a label — "Q1 2024" / "Q3 2023" / ISO date / year
function labelSortKey(val) {
	if (val == null) return null
	const s = String(val).trim()
	// "Q{n} YYYY" or "YYYY Q{n}"
	let m = s.match(/^Q([1-4])\s+(\d{4})$/i)
	if (m) return Number(m[2]) * 10 + Number(m[1])
	m = s.match(/^(\d{4})\s+Q([1-4])$/i)
	if (m) return Number(m[1]) * 10 + Number(m[2])
	// plain year
	if (/^\d{4}$/.test(s)) return Number(s)
	// ISO date or any Date.parse-able
	const t = Date.parse(s)
	if (!isNaN(t)) return t
	return null
}

// sort x domain chronologically — prefer period_sort column, fallback to label parsing
function sortedXDomain(options) {
	const { rows, xCol } = options
	if (!rows[0]) return undefined
	const hasPeriodSort = rows[0].period_sort != null
	const seen = new Map()
	for (const r of rows) {
		const key = r[xCol]
		if (seen.has(key)) continue
		const sortKey = hasPeriodSort ? +r.period_sort : labelSortKey(key)
		seen.set(key, sortKey)
	}
	// bail out if we could not derive a numeric sort key for any entry
	for (const v of seen.values()) {
		if (v == null || isNaN(v)) return undefined
	}
	return Array.from(seen.entries()).sort(function (a, b) { return a[1] - b[1] }).map(function (e) { return e[0] })
}

// when many x-axis labels, rotate them so they don't overlap
function applyTickDensity(xOpts, domain) {
	const count = domain ? domain.length : 0
	if (count > 6) {
		xOpts.tickRotate = -45
	}
}

function truncLabel(d) {
	const s = String(d)
	return s.length > 8 ? s.slice(0, 7) + '…' : s
}

function top8Filter(options) {
	const { rows, catCol, yCol } = options
	const agg = new Map()
	for (const r of rows) {
		const key = r[catCol]
		agg.set(key, (agg.get(key) || 0) + (Number(r[yCol]) || 0))
	}
	const topSet = new Set(
		Array.from(agg.entries())
			.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
			.slice(0, 8)
			.map(e => e[0])
	)
	return rows.filter(r => topSet.has(r[catCol]))
}

// when fx facets are used, limit x-domain to the most recent N periods that fit
function maxPeriodsForFacets(options) {
    const { rows, xCol, fxCol, width } = options
    const numFacets = new Set(rows.map(r => r[fxCol])).size || 1
    const facetWidth = (width || 700) / numFacets
    return Math.max(2, Math.floor(facetWidth / 24)) // ~24px minimum per x tick
}

// for bar charts, sort x-domain by y-value descending (highest first)
function sortedBarDomain(options) {
	const { rows, xCol, yCol } = options
	const agg = new Map()
	for (const r of rows) {
		const key = r[xCol]
		const val = Number(r[yCol]) || 0
		if (!agg.has(key)) {
			agg.set(key, val)
		} else {
			agg.set(key, agg.get(key) + val)
		}
	}
	return Array.from(agg.entries())
		.sort(function (a, b) { return Math.abs(b[1]) - Math.abs(a[1]) })
		.map(function (e) { return e[0] })
}

function buildFromConfig(options) {
	const { config, rows, columns, width } = options
	const marks = []
	const xCol = config.marks[0] ? config.marks[0].x : null
	const yCol = config.marks[0] ? config.marks[0].y : null
	const isBar = config.marks[0] && config.marks[0].type === "barY"

	// apply top-8 filtering for categorical dimensions
	let filteredRows = rows
	for (const m of config.marks) {
		if (m.fx) {
			const unique = new Set(filteredRows.map(r => r[m.fx]))
			if (unique.size > 8) filteredRows = top8Filter({ rows: filteredRows, catCol: m.fx, yCol: m.y })
		}
		const seriesCol = m.stroke || m.fill
		if (seriesCol && seriesCol !== "period_label") {
			const unique = new Set(filteredRows.map(r => r[seriesCol]))
			if (unique.size > 8) filteredRows = top8Filter({ rows: filteredRows, catCol: seriesCol, yCol: m.y })
		}
	}

	// for bar charts without time axis, sort by y-value descending, cap at 8
	let xDomain = isBar && xCol !== "period_label"
		? sortedBarDomain({ rows: filteredRows, xCol, yCol }).slice(0, 8)
		: xCol ? sortedXDomain({ rows: filteredRows, xCol }) : undefined

	// filter rows to xDomain if bar with categorical x
	if (isBar && xCol !== "period_label" && xDomain) {
		const xSet = new Set(xDomain)
		filteredRows = filteredRows.filter(r => xSet.has(r[xCol]))
	}

	// when fx facets are used, limit x to most recent periods that fit per-facet width
	const fxCol = config.marks[0] && config.marks[0].fx
	if (fxCol && xCol && xDomain) {
		const maxX = maxPeriodsForFacets({ rows: filteredRows, xCol, fxCol, width })
		if (xDomain.length > maxX) {
			xDomain = xDomain.slice(-maxX) // keep most recent
			const xSet = new Set(xDomain)
			filteredRows = filteredRows.filter(r => xSet.has(r[xCol]))
		}
	}

	for (const m of config.marks) {
		const fn = MARK_FN[m.type]
		if (!fn) continue
		const data = prepareData({ rows: filteredRows, columns, mark: m })
		const opts = { x: m.x, y: m.y }
		if (m.fx) opts.fx = m.fx
		if (m.stroke) opts.stroke = m.stroke
		if (m.fill) opts.fill = m.fill
		// always use spline for lines
		if (m.type === "lineY") opts.curve = m.curve || "catmull-rom"
		marks.push(fn(data, opts))
		if (m.type === "barY") marks.push(Plot.ruleY([0]))
		// hover tip — use proper channel names (stroke/fill), not raw column names
		const tipChannels = { x: m.x, y: m.y }
		if (m.stroke) tipChannels.stroke = m.stroke
		if (m.fill) tipChannels.fill = m.fill
		marks.push(Plot.tip(data, Plot.pointerX(tipChannels)))
	}

	marks.unshift(Plot.gridY())

	const xOpts = { ...(config.x || {}) }
	// use time scale when x values are dates
	if (xCol && filteredRows.length > 0 && isDateLike(filteredRows[0][xCol]) && !isBar) {
		xOpts.type = xOpts.type || "time"
	}
	if (xDomain) {
		xOpts.domain = xDomain
		applyTickDensity(xOpts, xDomain)
	}
	// categorical x: always show labels, truncate at 8 chars
	const isCategorical = xCol && filteredRows.length > 0 && !isDateLike(filteredRows[0][xCol]) && !isNumeric(filteredRows[0][xCol])
	if (isCategorical && !xOpts.tickFormat) {
		xOpts.tickFormat = truncLabel
	}
	// bar charts with long categorical labels need rotation even without explicit domain
	if (isBar && !xDomain) {
		const uniqueX = new Set(filteredRows.map(r => r[xCol]))
		if (uniqueX.size > 6) {
			xOpts.tickRotate = -45
		}
	}

	const colorCfg = normalizeColorConfig(config.color) || {}
	// sort legend chronologically when series is period_label
	const categoryCol = config.marks.map(m => m.stroke || m.fill).find(Boolean)
	if (categoryCol === "period_label") {
		const periodDomain = sortedXDomain({ rows: filteredRows, xCol: "period_label" })
		if (periodDomain) colorCfg.domain = periodDomain
	}

	const plotOpts = {
		className: "plot",
		style: ".plot-swatch { white-space: nowrap; }",
		width: width || 600,
		height: xOpts.tickRotate ? 340 : 300,
		marginBottom: xOpts.tickRotate ? 80 : undefined,
		x: xOpts,
		y: { grid: false, ...(config.y || {}) },
		color: { legend: true, ...colorCfg },
		marks,
	}
	if (config.fx) plotOpts.fx = config.fx
	return Plot.plot(plotOpts)
}

// columns that are never a useful y-axis metric
const SKIP_Y_COLS = new Set(["year", "period_sort", "period_label", "period_date", "quarter_label"])
// known categorical columns that should be used as stroke/fill for multi-series
const CATEGORY_COLS = new Set(["country", "service", "service_name", "business_model", "reach_type", "kpi_dimension", "age_group", "genre"])

// fallback heuristic when no plot_config from backend
function detectChartType(options) {
	const { columns, rows } = options
	if (columns.length < 2 || rows.length === 0) return null
	// prefer period_label as x if available, else first column
	const xCol = columns.includes("period_label") ? "period_label" : columns[0]
	const yCols = columns.filter(function (col) {
		if (col === xCol || SKIP_Y_COLS.has(col)) return false
		return rows.some(function (r) { return isNumeric(r[col]) })
	})
	if (yCols.length === 0) return null
	const yCol = yCols[0]
	// detect multi-series categorical column
	const strokeCol = columns.find(function (col) {
		if (col === xCol || col === yCol || SKIP_Y_COLS.has(col)) return false
		if (!CATEGORY_COLS.has(col)) return false
		const unique = new Set(rows.map(function (r) { return r[col] }))
		return unique.size > 1
	}) || null
	const firstX = rows[0][xCol]
	if (isDateLike(firstX)) return { type: "line", x: xCol, y: yCol, stroke: strokeCol }
	// period_label: few periods + category → grouped bars; many periods → line
	if (xCol === "period_label") {
		const uniquePeriods = new Set(rows.map(function (r) { return r[xCol] }))
		if (uniquePeriods.size <= 3 && strokeCol) {
			return { type: "bar", x: xCol, y: yCol, fill: "period_label", fx: strokeCol }
		}
		return { type: "line", x: xCol, y: yCol, stroke: strokeCol }
	}
	if (isNumeric(firstX)) return { type: "dot", x: xCol, y: yCol, stroke: strokeCol }
	return { type: "bar", x: xCol, y: yCol, fill: strokeCol }
}

function buildFallback(options) {
	const { columns, rows, width } = options
	const chartInfo = detectChartType({ columns, rows })
	if (!chartInfo) return null

	// apply top-8 filtering for categorical dimensions
	let filteredRows = rows
	const seriesCol = chartInfo.stroke || chartInfo.fill
	if (seriesCol && seriesCol !== "period_label") {
		const unique = new Set(filteredRows.map(r => r[seriesCol]))
		if (unique.size > 8) filteredRows = top8Filter({ rows: filteredRows, catCol: seriesCol, yCol: chartInfo.y })
	}

	// for bar charts with categorical x, sort by y-value and cap at 8; otherwise sort by period_sort
	let xDomain = chartInfo.type === "bar" && chartInfo.x !== "period_label"
		? sortedBarDomain({ rows: filteredRows, xCol: chartInfo.x, yCol: chartInfo.y }).slice(0, 8)
		: sortedXDomain({ rows: filteredRows, xCol: chartInfo.x })

	// filter rows to xDomain if bar with categorical x
	if (chartInfo.type === "bar" && chartInfo.x !== "period_label" && xDomain) {
		const xSet = new Set(xDomain)
		filteredRows = filteredRows.filter(r => xSet.has(r[chartInfo.x]))
	}

	const data = filteredRows.map(function (row) {
		const d = {}
		for (const col of columns) {
			d[col] = row[col]
		}
		if (chartInfo.type === "line" && isDateLike(d[chartInfo.x])) {
			d[chartInfo.x] = new Date(d[chartInfo.x])
		}
		if (isNumeric(d[chartInfo.y])) d[chartInfo.y] = Number(d[chartInfo.y])
		if (chartInfo.type === "dot" && isNumeric(d[chartInfo.x])) {
			d[chartInfo.x] = Number(d[chartInfo.x])
		}
		return d
	})

	const tipChannels = { x: chartInfo.x, y: chartInfo.y }
	if (chartInfo.stroke) tipChannels.stroke = chartInfo.stroke
	if (chartInfo.fill) tipChannels.fill = chartInfo.fill
	const hasCategory = chartInfo.stroke || chartInfo.fill
	let marks = []
	if (chartInfo.type === "bar") {
		const barOpts = { x: chartInfo.x, y: chartInfo.y, fill: chartInfo.fill }
		if (chartInfo.fx) barOpts.fx = chartInfo.fx
		marks = [
			Plot.barY(data, barOpts),
			Plot.ruleY([0]),
			Plot.tip(data, Plot.pointerX(tipChannels)),
		]
	}
	if (chartInfo.type === "line") {
		const lineOpts = { x: chartInfo.x, y: chartInfo.y, stroke: chartInfo.stroke, curve: "catmull-rom", sort: null }
		marks = [
			Plot.lineY(data, lineOpts),
			Plot.tip(data, Plot.pointerX(tipChannels)),
		]
	}
	if (chartInfo.type === "dot") {
		marks = [
			Plot.dot(data, { x: chartInfo.x, y: chartInfo.y, fill: chartInfo.stroke }),
			Plot.tip(data, Plot.pointerX(tipChannels)),
		]
	}

	marks.unshift(Plot.gridY())

	const xOpts = { label: chartInfo.x }
	if (xDomain) {
		xOpts.domain = xDomain
		applyTickDensity(xOpts, xDomain)
	}
	// categorical x: always show labels, truncate at 8 chars
	const isCategorical = chartInfo.x && filteredRows.length > 0 && !isDateLike(filteredRows[0][chartInfo.x]) && !isNumeric(filteredRows[0][chartInfo.x])
	if (isCategorical && !xOpts.tickFormat) {
		xOpts.tickFormat = truncLabel
	}

	const plotOpts = {
		width: width || 600,
		height: xOpts.tickRotate ? 340 : 300,
		marginBottom: xOpts.tickRotate ? 80 : undefined,
		x: xOpts,
		y: { label: chartInfo.y, grid: false },
		marks,
	}
	if (hasCategory) {
		const categoryCol = chartInfo.stroke || chartInfo.fill
		const colorCfg = { legend: true }
		if (categoryCol === "period_label") {
			const periodDomain = sortedXDomain({ rows: filteredRows, xCol: "period_label" })
			if (periodDomain) colorCfg.domain = periodDomain
		}
		plotOpts.color = colorCfg
	}
	if (chartInfo.fx) {
		plotOpts.fx = { label: null }
		plotOpts.x = { ...plotOpts.x, axis: null }
	}
	return Plot.plot(plotOpts)
}

// how long to wait for plot_config before showing fallback (ms)
const FALLBACK_DELAY = 5000

function appendResponsiveSVG($el, chart) {
	const nw = chart.getAttribute("width")
	const nh = chart.getAttribute("height")
	if (nw && nh) {
		chart.setAttribute("viewBox", "0 0 " + nw + " " + nh)
		chart.removeAttribute("width")
		chart.removeAttribute("height")
	}
	$el.appendChild(chart)
}

function ResultChart(options) {
	const { columns, rows, plot_config, msg_id } = options
	const $container = useRef(null)
	const [activeConfig, setActiveConfig] = useState(plot_config)
	const [editing, setEditing] = useState(false)
	const [fallbackReady, setFallbackReady] = useState(!!plot_config)
	const [draft, setDraft] = useState(() => plot_config ? JSON.stringify(plot_config, null, 2) : "")
	const [configError, setConfigError] = useState("")
	const [renderError, setRenderError] = useState("")
	const [saving, setSaving] = useState(false)

	// sync when prop changes (new message streamed in)
	useEffect(function () {
		setActiveConfig(plot_config)
		setDraft(plot_config ? JSON.stringify(plot_config, null, 2) : "")
		setConfigError("")
		setEditing(false)
		if (plot_config) setFallbackReady(true)
	}, [plot_config])

	// delay fallback: if no plot_config, wait FALLBACK_DELAY before showing fallback
	useEffect(function () {
		if (activeConfig) return // config already available, no timer needed
		const timer = setTimeout(function () { setFallbackReady(true) }, FALLBACK_DELAY)
		return function () { clearTimeout(timer) }
	}, [activeConfig])

	// render chart
	useEffect(function () {
		if (!$container.current) return
		$container.current.innerHTML = ""
		setRenderError("")

		const hasConfig = activeConfig && activeConfig.marks && activeConfig.marks.length > 0

		// wait for config or fallback timeout
		if (!hasConfig && !fallbackReady) return

		const w = 700
		let chart = null
		if (hasConfig) {
			try {
				chart = buildFromConfig({ config: activeConfig, rows, columns, width: w })
			} catch (e) {
				console.error("[ResultChart] plot_config render failed, falling back", e)
				setRenderError(e.message)
				chart = buildFallback({ columns, rows, width: w })
			}
		} else {
			chart = buildFallback({ columns, rows, width: w })
		}

		if (chart) appendResponsiveSVG($container.current, chart)
	}, [columns, rows, activeConfig, fallbackReady])

	function handleReplot() {
		try {
			const parsed = JSON.parse(draft)
			setConfigError("")
			setActiveConfig(parsed)
			setEditing(false)
		} catch (e) {
			setConfigError(e.message)
		}
	}

	function handleSave() {
		if (!msg_id) return
		let parsed = activeConfig
		if (editing) {
			try {
				parsed = JSON.parse(draft)
				setConfigError("")
				setActiveConfig(parsed)
				setEditing(false)
			} catch (e) {
				setConfigError(e.message)
				return
			}
		}
		// plot config edits stay client-side only (no backend PATCH)
		setSaving(false)
	}

	function openEdit(e) {
		e.preventDefault()
		setDraft(activeConfig ? JSON.stringify(activeConfig, null, 2) : "")
		setEditing(true)
	}

	function cancelEdit(e) {
		e.preventDefault()
		setEditing(false)
		setConfigError("")
	}

	return (
		<div>
			<div className="chart-container" ref={$container}></div>
			{renderError && <div className="code-error">Plot config render error: {renderError}</div>}
			{activeConfig && (
				<details className="collapsible">
					<summary>Plot config</summary>
					<div className="collapsible-body">
						{editing ? (
							<div className="code-edit-wrap">
								<textarea
									className="code-textarea"
									value={draft}
									onChange={function (e) { setDraft(e.target.value) }}
									rows={Math.max(6, draft.split('\n').length + 1)}
									spellCheck={false}
								/>
								{configError && <div className="code-error">{configError}</div>}
								<div className="code-edit-actions">
									<button className="code-run-btn" onClick={handleReplot}>Replot</button>
									{msg_id && <button className="code-run-btn" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</button>}
									<button className="code-cancel-btn" onClick={cancelEdit}>Cancel</button>
								</div>
							</div>
						) : (
							<div>
								<div className="sql-block">
									<code dangerouslySetInnerHTML={{ __html: highlightJSON(activeConfig) }} />
								</div>
								<div className="code-edit-actions">
									<button className="code-inline-btn" onClick={openEdit}>edit</button>
									{msg_id && <button className="code-inline-btn" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "save"}</button>}
								</div>
							</div>
						)}
					</div>
				</details>
			)}
		</div>
	)
}

export default ResultChart
