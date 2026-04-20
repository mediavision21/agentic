import { useRef, useEffect } from "react"
import * as _Plot from "@observablehq/plot"
import ResultChart from "./ResultChart.jsx"

const Plot = { ..._Plot, plot: opts => _Plot.plot({ className: "plot", ...opts }) }

function TemplatePlotView(options) {
    const { plot, rows } = options
    const $container = useRef(null)

    useEffect(function () {
        if (!$container.current || !rows || rows.length === 0) return
        $container.current.innerHTML = ""
        try {
            const fn = new Function("Plot", "__rows__", "var data = __rows__;\n" + plot.code)
            const chart = fn(Plot, rows)
            if (chart) $container.current.appendChild(chart)
        } catch (e) {
            console.error("[TemplatePlot] render error:", e)
            $container.current.textContent = "Plot render error: " + e.message
        }
    }, [plot, rows])

    return <div className="chart-container" ref={$container}></div>
}

function PlotPanel(options) {
    const { plotView, onClose } = options

    if (!plotView) return null

    const { name, description, columns, rows, plots, error, loading } = plotView

    return (
        <div className="eval-panel-content">
            <div className="eval-mode-banner">
                <button className="eval-mode-back" onClick={onClose}>← Back</button>
                <span style={{ marginLeft: "8px", opacity: 0.7, fontSize: "13px" }}>{name}</span>
            </div>
            <div className="chat-window">
                <div className="chat-messages">
                    {loading && <div className="skill-item eval-empty">Running SQL...</div>}
                    {error && <div className="error-msg">{error}</div>}
                    {!loading && !error && (
                        <div className="bubble-row assistant">
                            <div className="bubble bubble-assistant">
                                {description && <p style={{ marginTop: 0 }}>{description}</p>}
                                {rows && rows.length > 0 && plots && plots.map(function (p) {
                                    return (
                                        <div key={p.id} className="template-plot">
                                            <div className="template-plot-title">{p.title}</div>
                                            {p.plot_config
                                                ? <ResultChart columns={columns} rows={rows} plot_config={p.plot_config} />
                                                : <TemplatePlotView plot={p} rows={rows} />
                                            }
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default PlotPanel
