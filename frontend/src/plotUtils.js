import * as _Plot from "@observablehq/plot"

const Plot = { ..._Plot, plot: opts => _Plot.plot({ className: "plot", ...opts }) }

function fmtPeriod(s) {
	const d = new Date(s)
	return 'Q' + Math.ceil((d.getUTCMonth() + 1) / 3) + ' ' + d.getUTCFullYear()
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

function labelSortKey(val) {
	if (val == null) return null
	const s = String(val).trim()
	let m = s.match(/^Q([1-4])\s+(\d{4})$/i)
	if (m) return Number(m[2]) * 10 + Number(m[1])
	m = s.match(/^(\d{4})\s+Q([1-4])$/i)
	if (m) return Number(m[1]) * 10 + Number(m[2])
	if (/^\d{4}$/.test(s)) return Number(s)
	const t = Date.parse(s)
	if (!isNaN(t)) return t
	return null
}

function sortedXDomain(options) {
	const { rows, xCol } = options
	if (!rows[0]) return undefined
	const seen = new Map()
	for (const r of rows) {
		const key = r[xCol]
		if (seen.has(key)) continue
		const sortKey = labelSortKey(key)
		seen.set(key, sortKey)
	}
	for (const v of seen.values()) {
		if (v == null || isNaN(v)) return undefined
	}
	return Array.from(seen.entries()).sort(function (a, b) { return a[1] - b[1] }).map(function (e) { return e[0] })
}

function applyTickDensity(xOpts, domain) {
	const count = domain ? domain.length : 0
	const hasLongLabel = domain ? domain.some(d => String(d).length > 10) : false
	if (count > 6 || hasLongLabel) {
		xOpts.tickRotate = -45
	}
}

function truncLabel(d) {
	const s = String(d)
	return s.length > 8 ? s.slice(0, 7) + '…' : s
}

function topFilter(options) {
	const { rows, catCol, yCol } = options
	const agg = new Map()
	for (const r of rows) {
		const key = r[catCol]
		agg.set(key, (agg.get(key) || 0) + (Number(r[yCol]) || 0))
	}
	const topSet = new Set(
		Array.from(agg.entries())
			.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
			.slice(0, 30)
			.map(e => e[0])
	)
	return rows.filter(r => topSet.has(r[catCol]))
}

function maxPeriodsForFacets(options) {
	const { rows, xCol, fxCol, width } = options
	const numFacets = new Set(rows.map(r => r[fxCol])).size || 1
	const facetWidth = (width || 700) / numFacets
	return Math.max(2, Math.floor(facetWidth / 24))
}

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

const MARK_FN = {
	lineY: Plot.lineY,
	barY: Plot.barY,
	dot: Plot.dot,
	areaY: Plot.areaY,
}

export function buildFromConfig(options) {
	let { config, width } = options
	let { rows, columns } = options
	if (typeof config === 'string') config = JSON.parse(config)

	// auto-compute period_label from period_date if config references it
	const allMarkCols = config.marks.flatMap(m => ['x', 'y', 'fx', 'stroke', 'fill', 'z'].map(k => m[k]).filter(v => typeof v === 'string'))
	if (allMarkCols.includes('period_label') && columns.includes('period_date') && !columns.includes('period_label')) {
		rows = rows.map(r => ({ ...r, period_label: r.period_date ? fmtPeriod(r.period_date) : null }))
		columns = [...columns, 'period_label']
	}

	const marks = []
	const xCol = config.marks[0] ? config.marks[0].x : null
	const yCol = config.marks[0] ? config.marks[0].y : null
	const isBar = config.marks[0] && config.marks[0].type === "barY"

	let filteredRows = rows
	for (const m of config.marks) {
		if (m.fx) {
			const unique = new Set(filteredRows.map(r => r[m.fx]))
			if (unique.size > 30) filteredRows = topFilter({ rows: filteredRows, catCol: m.fx, yCol: m.y })
		}
		const seriesCol = m.stroke || m.fill
		if (seriesCol) {
			const unique = new Set(filteredRows.map(r => r[seriesCol]))
			if (unique.size > 30) filteredRows = topFilter({ rows: filteredRows, catCol: seriesCol, yCol: m.y })
		}
	}

	// period_label is a formatted date string — sort chronologically, not by y-value
	const isPeriodLabelX = xCol === "period_label"
	let xDomain = isBar && xCol !== "period_date" && !isPeriodLabelX
		? sortedBarDomain({ rows: filteredRows, xCol, yCol }).slice(0, 30)
		: xCol ? sortedXDomain({ rows: filteredRows, xCol }) : undefined

	if (isBar && xCol !== "period_date" && xDomain) {
		const xSet = new Set(xDomain)
		filteredRows = filteredRows.filter(r => xSet.has(r[xCol]))
	}

	const fxCol = config.marks[0] && config.marks[0].fx
	if (fxCol && xCol && xDomain) {
		const maxX = maxPeriodsForFacets({ rows: filteredRows, xCol, fxCol, width })
		if (xDomain.length > maxX) {
			xDomain = xDomain.slice(-maxX)
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
		if (m.type === "lineY") opts.curve = m.curve || "catmull-rom"

		if (m.stack) {
			// stacked area/bar: use Plot.stackY transform
			const stackOpts = { x: m.x, y: m.y }
			if (m.fx) stackOpts.fx = m.fx
			if (m.fill) stackOpts.fill = m.fill
			if (m.stroke) stackOpts.stroke = m.stroke
			if (m.z) stackOpts.z = m.z
			if (m.curve) stackOpts.curve = m.curve
			if (m.order) stackOpts.order = m.order
			marks.push(fn(data, Plot.stackY(stackOpts)))
		} else {
			marks.push(fn(data, opts))
		}

		if (m.type === "barY" && !m.stack) marks.push(Plot.ruleY([0]))

		const tipChannels = { x: m.x, y: m.y }
		if (m.stroke) tipChannels.stroke = m.stroke
		if (m.fill) tipChannels.fill = m.fill
		marks.push(Plot.tip(data, Plot.pointerX(tipChannels)))
	}

	marks.unshift(Plot.gridY())

	const xOpts = { ...(config.x || {}) }
	if (xCol && filteredRows.length > 0 && isDateLike(filteredRows[0][xCol]) && !isBar) {
		xOpts.type = xOpts.type || "time"
	}
	if (xDomain) {
		xOpts.domain = xDomain
		applyTickDensity(xOpts, xDomain)
	}
	const isCategorical = xCol && filteredRows.length > 0 && !isDateLike(filteredRows[0][xCol]) && !isNumeric(filteredRows[0][xCol])
	if (isCategorical && !xOpts.tickFormat && !isPeriodLabelX) {
		xOpts.tickFormat = truncLabel
	}
	if (isBar && !xDomain) {
		const uniqueX = new Set(filteredRows.map(r => r[xCol]))
		const hasLongLabel = [...uniqueX].some(d => String(d).length > 10)
		if (uniqueX.size > 6 || hasLongLabel) {
			xOpts.tickRotate = -45
		}
	}
	// when fx+x coexist, ticks are squeezed within each facet — always rotate
	if (fxCol && !xOpts.tickRotate) {
		xOpts.tickRotate = -45
	}

	const colorCfg = normalizeColorConfig(config.color) || {}
	const categoryCol = config.marks.map(m => m.stroke || m.fill).find(Boolean)
	if (categoryCol === "period_date" || categoryCol === "period_label") {
		const periodDomain = sortedXDomain({ rows: filteredRows, xCol: categoryCol })
		if (periodDomain) colorCfg.domain = periodDomain
	}

	const plotOpts = {
		className: "plot",
		style: ".plot-swatch { white-space: nowrap; }",
		width: width || 600,
		height: xOpts.tickRotate ? 340 : 300,
		marginBottom: xOpts.tickRotate ? 50 : undefined,
		x: xOpts,
		y: { grid: false, ...(config.y || {}) },
		color: { legend: true, ...colorCfg },
		marks,
	}
	if (config.fx) plotOpts.fx = config.fx
	if (fxCol) {
		const uniqueFx = [...new Set(filteredRows.map(r => r[fxCol]))]
		const hasLongFxLabel = uniqueFx.some(d => String(d).length > 10) || uniqueFx.size > 6
		if (hasLongFxLabel) {
			plotOpts.fx = { tickRotate: 20, ...(plotOpts.fx || {}) }
			// plotOpts.marginBottom = Math.min((plotOpts.marginBottom || 0) + 50
			// plotOpts.marginTop = (plotOpts.marginTop || 0) + 50
		}
	}
	return Plot.plot(plotOpts)
}

const SKIP_Y_COLS = new Set(["period_date"])
const CATEGORY_COLS = new Set(["country", "service", "service_name", "business_model", "reach_type", "kpi_dimension", "age_group", "genre"])

export function detectChartType(options) {
	const { columns, rows } = options
	if (columns.length < 2 || rows.length === 0) return null
	const xCol = columns.includes("period_date") ? "period_date" : columns[0]
	const yCols = columns.filter(function (col) {
		if (col === xCol || SKIP_Y_COLS.has(col)) return false
		return rows.some(function (r) { return isNumeric(r[col]) })
	})
	if (yCols.length === 0) return null
	const yCol = yCols[0]
	const strokeCol = columns.find(function (col) {
		if (col === xCol || col === yCol || SKIP_Y_COLS.has(col)) return false
		if (!CATEGORY_COLS.has(col)) return false
		const unique = new Set(rows.map(function (r) { return r[col] }))
		return unique.size > 1
	}) || null
	const firstX = rows[0][xCol]
	if (isDateLike(firstX)) return { type: "line", x: xCol, y: yCol, stroke: strokeCol }
	if (xCol === "period_date") {
		const uniquePeriods = new Set(rows.map(function (r) { return r[xCol] }))
		if (uniquePeriods.size <= 3 && strokeCol) {
			return { type: "bar", x: xCol, y: yCol, fill: "period_date", fx: strokeCol }
		}
		return { type: "line", x: xCol, y: yCol, stroke: strokeCol }
	}
	if (isNumeric(firstX)) return { type: "dot", x: xCol, y: yCol, stroke: strokeCol }
	return { type: "bar", x: xCol, y: yCol, fill: strokeCol }
}

export function buildFallback(options) {
	const { columns, rows, width } = options
	const chartInfo = detectChartType({ columns, rows })
	if (!chartInfo) return null

	let filteredRows = rows
	const seriesCol = chartInfo.stroke || chartInfo.fill
	if (seriesCol) {
		const unique = new Set(filteredRows.map(r => r[seriesCol]))
		if (unique.size > 30) filteredRows = topFilter({ rows: filteredRows, catCol: seriesCol, yCol: chartInfo.y })
	}

	let xDomain = chartInfo.type === "bar" && chartInfo.x !== "period_date"
		? sortedBarDomain({ rows: filteredRows, xCol: chartInfo.x, yCol: chartInfo.y }).slice(0, 30)
		: sortedXDomain({ rows: filteredRows, xCol: chartInfo.x })

	if (chartInfo.type === "bar" && chartInfo.x !== "period_date" && xDomain) {
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
	const isCategorical = chartInfo.x && filteredRows.length > 0 && !isDateLike(filteredRows[0][chartInfo.x]) && !isNumeric(filteredRows[0][chartInfo.x])
	if (isCategorical && !xOpts.tickFormat) {
		xOpts.tickFormat = truncLabel
	}
	if (isCategorical && !xDomain) {
		const uniqueX = [...new Set(filteredRows.map(r => r[chartInfo.x]))]
		const hasLongLabel = uniqueX.some(d => String(d).length > 10)
		if (uniqueX.size > 6 || hasLongLabel) xOpts.tickRotate = -45
	}

	const plotOpts = {
		className: "plot",
		style: ".plot-swatch { white-space: nowrap; }",
		width: width || 600,
		height: xOpts.tickRotate ? 340 : 300,
		marginBottom: xOpts.tickRotate ? 80 : undefined,
		x: xOpts,
		y: { label: chartInfo.y, grid: false },
		marks,
	}
	if (hasCategory) {
		plotOpts.color = { legend: true }
	}
	if (chartInfo.fx) {
		plotOpts.fx = { label: null }
		plotOpts.x = { ...plotOpts.x, axis: null }
	}
	return Plot.plot(plotOpts)
}

export function appendResponsiveSVG($el, chart) {
	const nw = chart.getAttribute("width")
	const nh = chart.getAttribute("height")
	if (nw && nh) {
		chart.setAttribute("viewBox", "0 0 " + nw + " " + nh)
		chart.removeAttribute("width")
		chart.removeAttribute("height")
	}
	$el.appendChild(chart)
}
