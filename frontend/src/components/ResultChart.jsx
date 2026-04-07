import { useRef, useEffect, useState } from "react"
import * as Plot from "@observablehq/plot"
import { voiTheme, voiColors } from "../voi-theme.js"
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
        if (mark.type === "lineY" && isDateLike(d[mark.x])) {
            d[mark.x] = new Date(d[mark.x])
        }
        if (isNumeric(d[mark.y])) {
            d[mark.y] = Number(d[mark.y])
        }
        if (mark.type === "dot" && isNumeric(d[mark.x])) {
            d[mark.x] = Number(d[mark.x])
        }
        return d
    })
}

// if LLM returns scheme as comma-separated hex string, convert to range array
function normalizeColorConfig(colorCfg) {
    if (!colorCfg) return colorCfg
    const out = { ...colorCfg }
    if (typeof out.scheme === "string" && out.scheme.includes("#")) {
        out.range = out.scheme.split(",").map(function (s) { return s.trim() })
        delete out.scheme
    }
    return out
}

// sort period_label domain chronologically using period_sort when available
function sortedXDomain(options) {
    const { rows, xCol } = options
    if (!rows[0] || !rows[0].period_sort) return undefined
    const seen = new Map()
    for (const r of rows) {
        const key = r[xCol]
        if (!seen.has(key)) seen.set(key, +r.period_sort)
    }
    return Array.from(seen.entries()).sort(function (a, b) { return a[1] - b[1] }).map(function (e) { return e[0] })
}

// when many x-axis labels, rotate and thin them so they don't overlap
function applyTickDensity(xOpts, domain) {
    const count = domain ? domain.length : 0
    if (count > 12) {
        xOpts.tickRotate = -45
        // show every Nth label to avoid overlap
        const step = Math.ceil(count / 12)
        const keep = new Set(domain.filter(function (_, i) { return i % step === 0 }))
        xOpts.tickFormat = function (d) { return keep.has(d) ? d : "" }
    }
}

function buildFromConfig(options) {
    const { config, rows, columns, width } = options
    const marks = []
    const xCol = config.marks[0] ? config.marks[0].x : null
    const xDomain = xCol ? sortedXDomain({ rows, xCol }) : undefined

    for (const m of config.marks) {
        const fn = MARK_FN[m.type]
        if (!fn) continue
        const data = prepareData({ rows, columns, mark: m })
        const opts = { x: m.x, y: m.y }
        if (m.stroke) opts.stroke = m.stroke
        if (m.fill) opts.fill = m.fill
        // always use spline for lines
        if (m.type === "lineY") opts.curve = m.curve || "catmull-rom"
        // default color when no stroke/fill specified
        if (!m.stroke && !m.fill) {
            if (m.type === "lineY") opts.stroke = voiColors.series1
            else opts.fill = voiColors.series1
        }
        marks.push(fn(data, opts))
        if (m.type === "barY") marks.push(Plot.ruleY([0]))
        if (m.type === "lineY") {
            marks.push(Plot.dot(data, { x: m.x, y: m.y, fill: opts.stroke || voiColors.series1, r: 3 }))
        }
        // hover tip — use proper channel names (stroke/fill), not raw column names
        const tipChannels = { x: m.x, y: m.y }
        if (m.stroke) tipChannels.stroke = m.stroke
        if (m.fill) tipChannels.fill = m.fill
        marks.push(Plot.tip(data, Plot.pointerX(tipChannels)))
    }

    marks.unshift(Plot.gridY({ stroke: voiColors.grid, strokeWidth: 1 }))

    const xOpts = { ...voiTheme.x, ...(config.x || {}) }
    if (xDomain) {
        xOpts.domain = xDomain
        applyTickDensity(xOpts, xDomain)
    }

    const colorCfg = normalizeColorConfig(config.color) || {}

    const plotOpts = {
        ...voiTheme,
        width: width || 600,
        height: xOpts.tickRotate ? 340 : 300,
        marginBottom: xOpts.tickRotate ? 80 : undefined,
        x: xOpts,
        y: { ...voiTheme.y, grid: false, ...(config.y || {}) },
        color: { ...voiTheme.color, legend: true, ...colorCfg },
        marks,
    }
    return Plot.plot(plotOpts)
}

// columns that are never a useful y-axis metric
const SKIP_Y_COLS = new Set(["year", "period_sort", "period_label", "period_date", "quarter_label"])

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
    const firstX = rows[0][xCol]
    if (isDateLike(firstX)) return { type: "line", x: xCol, y: yCol }
    // period_label is categorical but represents time → use line
    if (xCol === "period_label") return { type: "line", x: xCol, y: yCol }
    if (isNumeric(firstX)) return { type: "dot", x: xCol, y: yCol }
    return { type: "bar", x: xCol, y: yCol }
}

function buildFallback(options) {
    const { columns, rows, width } = options
    const chartInfo = detectChartType({ columns, rows })
    if (!chartInfo) return null

    const data = rows.map(function (row) {
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

    // sort x-axis domain by period_sort when available
    const xDomain = sortedXDomain({ rows, xCol: chartInfo.x })

    const tipChannels = { x: chartInfo.x, y: chartInfo.y }
    let marks = []
    if (chartInfo.type === "bar") {
        marks = [
            Plot.barY(data, { x: chartInfo.x, y: chartInfo.y, fill: voiColors.series1 }),
            Plot.ruleY([0]),
            Plot.tip(data, Plot.pointerX(tipChannels)),
        ]
    }
    if (chartInfo.type === "line") {
        marks = [
            Plot.lineY(data, { x: chartInfo.x, y: chartInfo.y, stroke: voiColors.series1, curve: "catmull-rom", sort: null }),
            Plot.dot(data, { x: chartInfo.x, y: chartInfo.y, fill: voiColors.series1, r: 3 }),
            Plot.tip(data, Plot.pointerX(tipChannels)),
        ]
    }
    if (chartInfo.type === "dot") {
        marks = [
            Plot.dot(data, { x: chartInfo.x, y: chartInfo.y, fill: voiColors.series2 }),
            Plot.tip(data, Plot.pointerX(tipChannels)),
        ]
    }

    marks.unshift(Plot.gridY({ stroke: voiColors.grid, strokeWidth: 1 }))

    const xOpts = { ...voiTheme.x, label: chartInfo.x }
    if (xDomain) {
        xOpts.domain = xDomain
        applyTickDensity(xOpts, xDomain)
    }

    return Plot.plot({
        ...voiTheme,
        width: width || 600,
        height: xOpts.tickRotate ? 340 : 300,
        marginBottom: xOpts.tickRotate ? 80 : undefined,
        x: xOpts,
        y: { ...voiTheme.y, label: chartInfo.y, grid: false },
        marks,
    })
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
        setSaving(true)
        fetch(`/api/messages/${msg_id}/plot_config`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ plot_config: parsed }),
        }).then(function () {
            setSaving(false)
        }).catch(function () {
            setSaving(false)
        })
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
                    <summary>
                        Plot config
                        {!editing && (
                            <button className="code-inline-btn" onClick={openEdit}>edit</button>
                        )}
                    </summary>
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
                                {msg_id && (
                                    <div className="code-edit-actions">
                                        <button className="code-inline-btn" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "save"}</button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </details>
            )}
        </div>
    )
}

export default ResultChart
