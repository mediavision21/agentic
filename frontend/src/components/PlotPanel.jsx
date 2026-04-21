import { useRef, useEffect } from "react"
import ResultChart from "./ResultChart.jsx"
import { buildFromConfig, appendResponsiveSVG } from "../plotUtils.js"

function TemplatePlotView(options) {
    const { plot, rows, columns } = options
    const $container = useRef(null)

    useEffect(function () {
        if (!$container.current || !rows || rows.length === 0) return
        $container.current.innerHTML = ""
        try {
            const chart = buildFromConfig({ config: plot.config, rows, columns, width: 700 })
            if (chart) appendResponsiveSVG($container.current, chart)
        } catch (e) {
            console.error("[TemplatePlot] render error:", e)
            $container.current.textContent = "Plot render error: " + e.message
        }
    }, [plot, rows, columns])

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
                                                : <TemplatePlotView plot={p} rows={rows} columns={columns} />
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
