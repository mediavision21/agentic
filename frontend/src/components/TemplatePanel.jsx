import { useRef, useEffect } from "react"
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

    return (
        <div className="template-plot">
            <div className="template-plot-title">{plot.title}</div>
            <div className="chart-container" ref={$container}></div>
        </div>
    )
}

function TemplatePlots(options) {
    const { plots, rows, columns } = options
    if (!plots || plots.length === 0) return null
    return plots.map(function (p) {
        return <TemplatePlotView key={p.id} plot={p} rows={rows} columns={columns} />
    })
}

function TemplatePanel(options) {
    const { templateView, onClose } = options

    if (!templateView) return null

    const { name, description, sql, columns, rows, plots, error, loading } = templateView

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
                                {rows && rows.length > 0 && plots && (
                                    <TemplatePlots plots={plots} rows={rows} columns={columns} />
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export { TemplatePlots }
export default TemplatePanel
