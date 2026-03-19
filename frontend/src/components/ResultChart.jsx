import { useRef, useEffect } from "react"
import * as Plot from "@observablehq/plot"
import { voiTheme, voiColors } from "../voi-theme.js"

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

function buildFromConfig(options) {
    const { config, rows, columns } = options
    const marks = []

    for (const m of config.marks) {
        const fn = MARK_FN[m.type]
        if (!fn) continue
        const data = prepareData({ rows, columns, mark: m })
        const opts = { x: m.x, y: m.y }
        // stroke/fill: column reference or literal color
        if (m.stroke) opts.stroke = m.stroke
        if (m.fill) opts.fill = m.fill
        // default color when no stroke/fill specified
        if (!m.stroke && !m.fill) {
            opts.fill = m.type === "lineY" ? undefined : voiColors.series1
            if (m.type === "lineY") opts.stroke = voiColors.series1
        }
        marks.push(fn(data, opts))
        if (m.type === "barY") marks.push(Plot.ruleY([0]))
        if (m.type === "lineY") {
            marks.push(Plot.dot(data, { x: m.x, y: m.y, fill: opts.stroke || voiColors.series1, r: 3 }))
        }
        // hover tip
        const tipChannels = { x: m.x, y: m.y }
        if (m.stroke && columns.includes(m.stroke)) tipChannels[m.stroke] = m.stroke
        const pointer = m.type === "barY" ? Plot.pointer : Plot.pointerX
        marks.push(Plot.tip(data, pointer(tipChannels)))
    }

    marks.unshift(Plot.gridY({ stroke: voiColors.grid, strokeWidth: 1 }))

    const plotOpts = {
        ...voiTheme,
        width: 600,
        height: 300,
        x: { ...voiTheme.x, ...(config.x || {}) },
        y: { ...voiTheme.y, grid: false, ...(config.y || {}) },
        color: { ...voiTheme.color, legend: true },
        marks,
    }
    if (config.color) plotOpts.color = { ...voiTheme.color, ...config.color }
    return Plot.plot(plotOpts)
}

// fallback heuristic when no plot_config from backend
function detectChartType(options) {
    const { columns, rows } = options
    if (columns.length < 2 || rows.length === 0) return null
    const xCol = columns[0]
    const yCols = columns.slice(1).filter(function (col) {
        return rows.some(function (r) { return isNumeric(r[col]) })
    })
    if (yCols.length === 0) return null
    const yCol = yCols[0]
    const firstX = rows[0][xCol]
    if (isDateLike(firstX)) return { type: "line", x: xCol, y: yCol }
    if (isNumeric(firstX)) return { type: "dot", x: xCol, y: yCol }
    return { type: "bar", x: xCol, y: yCol }
}

function buildFallback(options) {
    const { columns, rows } = options
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

    const tipChannels = { x: chartInfo.x, y: chartInfo.y }
    let marks = []
    if (chartInfo.type === "bar") {
        marks = [
            Plot.barY(data, { x: chartInfo.x, y: chartInfo.y, fill: voiColors.series1 }),
            Plot.ruleY([0]),
            Plot.tip(data, Plot.pointer(tipChannels)),
        ]
    }
    if (chartInfo.type === "line") {
        marks = [
            Plot.lineY(data, { x: chartInfo.x, y: chartInfo.y, stroke: voiColors.series1 }),
            Plot.dot(data, { x: chartInfo.x, y: chartInfo.y, fill: voiColors.series1, r: 3 }),
            Plot.tip(data, Plot.pointerX(tipChannels)),
        ]
    }
    if (chartInfo.type === "dot") {
        marks = [
            Plot.dot(data, { x: chartInfo.x, y: chartInfo.y, fill: voiColors.series2 }),
            Plot.tip(data, Plot.pointer(tipChannels)),
        ]
    }

    marks.unshift(Plot.gridY({ stroke: voiColors.grid, strokeWidth: 1 }))

    return Plot.plot({
        ...voiTheme,
        width: 600,
        height: 300,
        x: { ...voiTheme.x, label: chartInfo.x },
        y: { ...voiTheme.y, label: chartInfo.y, grid: false },
        marks,
    })
}

function ResultChart(options) {
    const { columns, rows, plot_config } = options
    const $container = useRef(null)

    useEffect(function () {
        if (!$container.current) return
        $container.current.innerHTML = ""

        let chart = null
        if (plot_config && plot_config.marks && plot_config.marks.length > 0) {
            try {
                chart = buildFromConfig({ config: plot_config, rows, columns })
            } catch (e) {
                console.error("[ResultChart] plot_config render failed, falling back", e)
                chart = buildFallback({ columns, rows })
            }
        } else {
            chart = buildFallback({ columns, rows })
        }

        if (chart) $container.current.appendChild(chart)
    }, [columns, rows, plot_config])

    return (
        <div className="chart-container" ref={$container}></div>
    )
}

export default ResultChart
