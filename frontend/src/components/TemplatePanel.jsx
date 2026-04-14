import { useState, useRef, useEffect } from "react"
import * as Plot from "@observablehq/plot"

function TemplatePlotView(options) {
	const { plot, rows } = options
	const $container = useRef(null)

	useEffect(function () {
		if (!$container.current || !rows || rows.length === 0) return
		$container.current.innerHTML = ""
		try {
			const code = "var data = __rows__;\n" + plot.code
			const fn = new Function("Plot", "__rows__", code)
			const chart = fn(Plot, rows)
			if (chart) $container.current.appendChild(chart)
		} catch (e) {
			console.error("[TemplatePlot] render error:", e)
			$container.current.textContent = "Plot render error: " + e.message
		}
	}, [plot, rows])

	return (
		<div className="template-plot">
			<div className="template-plot-title">{plot.title}</div>
			<div className="chart-container" ref={$container}></div>
		</div>
	)
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
								{rows && rows.length > 0 && plots && plots.map(function (p) {
									return <TemplatePlotView key={p.id} plot={p} rows={rows} />
								})}
								{rows && rows.length === 0 && <div className="eval-empty">No data returned</div>}
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	)
}

export default TemplatePanel
