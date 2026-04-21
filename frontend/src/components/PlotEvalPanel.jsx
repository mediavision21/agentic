import { useState, useEffect, useRef } from "react"
import { buildFromConfig, appendResponsiveSVG } from "../plotUtils.js"

function VersionPanel(options) {
	const { label, configStr, rows, columns, description } = options
	const $chart = useRef(null)
	const [draft, setDraft] = useState(configStr || "")
	const [renderErr, setRenderErr] = useState("")
	const [score, setScore] = useState(null)
	const [scoring, setScoring] = useState(false)
	const [scoreErr, setScoreErr] = useState("")

	useEffect(function() {
		if (!$chart.current || !configStr) return
		try {
			const config = JSON.parse(configStr)
			$chart.current.innerHTML = ""
			const chart = buildFromConfig({ config, rows, columns, width: 700 })
			if (chart) appendResponsiveSVG($chart.current, chart)
			setRenderErr("")
		} catch(e) {
			setRenderErr(e.message)
		}
	}, [configStr, rows])

	function doRerun() {
		if (!$chart.current) return
		try {
			const config = JSON.parse(draft)
			$chart.current.innerHTML = ""
			const chart = buildFromConfig({ config, rows, columns, width: 700 })
			if (chart) appendResponsiveSVG($chart.current, chart)
			setRenderErr("")
		} catch(e) {
			setRenderErr(e.message)
		}
	}

	function doScore() {
		let config
		try {
			config = JSON.parse(draft)
		} catch(e) {
			setScoreErr("JSON error: " + e.message)
			return
		}
		setScoring(true)
		setScore(null)
		setScoreErr("")
		fetch("/eval/score", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ config, rows, description }),
		})
			.then(function(r) { return r.json() })
			.then(function(d) {
				setScore(d)
				setScoring(false)
			})
			.catch(function(err) {
				setScoreErr(err.message)
				setScoring(false)
			})
	}

	return (
		<div className="plot-eval-version-panel">
			<div className="plot-eval-panel-label">{label}</div>
			{configStr ? (
				<div>
					<textarea
						className="code-textarea"
						value={draft}
						onChange={function(e) { setDraft(e.target.value) }}
						rows={Math.max(6, draft.split('\n').length + 1)}
						spellCheck={false}
					/>
					<div className="code-edit-actions">
						<button className="code-run-btn" onClick={doRerun}>Rerun</button>
						<button className="code-run-btn" onClick={doScore} disabled={scoring}>
							{scoring ? "Scoring…" : "Score"}
						</button>
					</div>
					{renderErr && <div className="code-error">{renderErr}</div>}
					{scoreErr && <div className="code-error">{scoreErr}</div>}
					{score && (
						<div className="plot-eval-score">
							<strong>{score.score}/10</strong> — {score.reasoning}
						</div>
					)}
					<div className="chart-container" ref={$chart}></div>
				</div>
			) : (
				<div className="eval-empty">no data</div>
			)}
		</div>
	)
}

function DataPanel(options) {
	const { description, columns, rows } = options
	return (
		<div className="plot-eval-data-panel">
			<div className="plot-eval-panel-label">data</div>
			{description && <div className="plot-eval-desc">{description}</div>}
			<table className="plot-eval-table">
				<thead>
					<tr>
						{(columns || []).map(function(col) {
							return <th key={col}>{col}</th>
						})}
					</tr>
				</thead>
				<tbody>
					{(rows || []).slice(0, 20).map(function(row, i) {
						return (
							<tr key={i}>
								{(columns || []).map(function(col) {
									return <td key={col}>{row[col] ?? ""}</td>
								})}
							</tr>
						)
					})}
				</tbody>
			</table>
		</div>
	)
}

function PlotEvalPanel(options) {
	const { plotEvalView, onClose } = options

	if (!plotEvalView) return null

	const { name, description, rows, columns, data, loading } = plotEvalView
	const versions = Object.keys(data || {})

	return (
		<div className="eval-panel-content">
			<div className="eval-mode-banner">
				<button className="eval-mode-back" onClick={onClose}>← Back</button>
				<span style={{ marginLeft: "8px", opacity: 0.7, fontSize: "13px" }}>{name}</span>
			</div>
			<div className="chat-window">
				{loading ? (
					<div className="skill-item eval-empty">Loading…</div>
				) : (
					<div className="plot-eval-grid">
						{versions.map(function(vk) {
							return (
								<VersionPanel
									key={vk}
									label={vk}
									configStr={data[vk]}
									rows={rows || []}
									columns={columns || []}
									description={description || ""}
								/>
							)
						})}
						<DataPanel description={description} columns={columns} rows={rows} />
					</div>
				)}
			</div>
		</div>
	)
}

export default PlotEvalPanel
