import { useRef, useEffect } from "react"
import * as Plot from "@observablehq/plot"

function isNumeric(val) {
    if (val == null) return false
    return !isNaN(Number(val))
}

function isDateLike(val) {
    if (val == null) return false
    const str = String(val)
    return /^\d{4}-\d{2}/.test(str) || !isNaN(Date.parse(str))
}

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

    if (isDateLike(firstX)) {
        return { type: "line", x: xCol, y: yCol }
    }
    if (isNumeric(firstX)) {
        return { type: "dot", x: xCol, y: yCol }
    }
    return { type: "bar", x: xCol, y: yCol }
}

function ResultChart(options) {
    const { columns, rows } = options
    const $container = useRef(null)

    useEffect(function () {
        if (!$container.current) return
        $container.current.innerHTML = ""

        const chartInfo = detectChartType({ columns, rows })
        if (!chartInfo) return

        const data = rows.map(function (row) {
            const d = {}
            for (const col of columns) {
                d[col] = row[col]
            }
            if (chartInfo.type === "line" && isDateLike(d[chartInfo.x])) {
                d[chartInfo.x] = new Date(d[chartInfo.x])
            }
            if (isNumeric(d[chartInfo.y])) {
                d[chartInfo.y] = Number(d[chartInfo.y])
            }
            if (chartInfo.type === "dot" && isNumeric(d[chartInfo.x])) {
                d[chartInfo.x] = Number(d[chartInfo.x])
            }
            return d
        })

        let marks = []
        if (chartInfo.type === "bar") {
            marks = [
                Plot.barY(data, { x: chartInfo.x, y: chartInfo.y, fill: "var(--color-forest)" }),
                Plot.ruleY([0]),
            ]
        }
        if (chartInfo.type === "line") {
            marks = [
                Plot.lineY(data, { x: chartInfo.x, y: chartInfo.y, stroke: "var(--color-forest)" }),
                Plot.dot(data, { x: chartInfo.x, y: chartInfo.y, fill: "var(--color-forest)" }),
            ]
        }
        if (chartInfo.type === "dot") {
            marks = [
                Plot.dot(data, { x: chartInfo.x, y: chartInfo.y, fill: "var(--color-forest)" }),
            ]
        }

        const chart = Plot.plot({
            width: 600,
            height: 300,
            style: {
                background: "transparent",
                color: "var(--color-gray-dark)",
                fontSize: "12px",
            },
            x: { label: chartInfo.x },
            y: { label: chartInfo.y, grid: true },
            marks: marks,
        })

        $container.current.appendChild(chart)
    }, [columns, rows])

    return (
        <div className="chart-container" ref={$container}></div>
    )
}

export default ResultChart
