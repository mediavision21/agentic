import { useState, useRef, useEffect } from "react"
import { highlightMarkdown, highlightJSON } from "../highlight.js"
import SqlDisplay from "./SqlDisplay.jsx"
import ResultTable from "./ResultTable.jsx"
import ResultChart from "./ResultChart.jsx"
import Markdown from "./Markdown.jsx"
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
	const [activeId, setActiveId] = useState(plots[0] ? plots[0].id : null)
	const active = plots.find(function (p) { return p.id === activeId })

	return (
		<div className="template-plots">
			<div className="template-plot-tabs">
				{plots.map(function (p) {
					return (
						<button
							key={p.id}
							className={"template-plot-tab" + (p.id === activeId ? " active" : "")}
							onClick={function () { setActiveId(p.id) }}
						>
							{p.title}
						</button>
					)
				})}
			</div>
			{active && <TemplatePlotView plot={active} rows={rows} columns={columns} />}
		</div>
	)
}

// 👎 left, 👍 right — clicking 👎 slides down a comment box
function EvalBar(options) {
	const { msgId, user } = options
	const [rating, setRating] = useState(null)
	const [showComment, setShowComment] = useState(false)
	const [comment, setComment] = useState("")

	async function rate(r) {
		setRating(r)
		if (r === "bad") {
			setShowComment(true) // open comment box
		}
		if (r === "good") {
			setShowComment(false)
			await fetch("/api/evaluate", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ msg_id: msgId, rating: r, user: user || "" }),
				credentials: "include",
			})
			setSaved(true)
		}
	}

	const [saved, setSaved] = useState(false)

	async function submitComment() {
		await fetch("/api/evaluate", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ msg_id: msgId, rating: "bad", comment, user: user || "" }),
			credentials: "include",
		})
		setShowComment(false)
		setSaved(true)
	}

	return (
		<div className="eval-bar">
			<div className="eval-buttons">
				<button
					className={"eval-btn" + (rating === "bad" ? " active" : "")}
					onClick={function () { rate("bad") }}
					title="bad"
				>👎</button>
				<div className="eval-spacer" />
				<button
					className={"eval-btn" + (rating === "good" ? " active" : "")}
					onClick={function () { rate("good") }}
					title="good"
				>👍</button>
			</div>
			{saved && (
				<div className="eval-saved-comment">
					<span className="eval-saved-user">{user || "User"} {rating === "good" ? "👍" : "👎"}</span>
					{comment && <span className="eval-saved-text">{comment}</span>}
				</div>
			)}
			<div className={"eval-comment-box" + (showComment ? " open" : "")}>
				<textarea
					className="eval-comment-input"
					placeholder="What went wrong? (Enter to save, Shift+Enter for new line)"
					value={comment}
					onChange={function (e) { setComment(e.target.value) }}
					onKeyDown={function (e) {
						if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
							e.preventDefault()
							submitComment()
						}
					}}
					rows={3}
				/>
				<button className="eval-comment-submit" onClick={submitComment}>Save</button>
			</div>
		</div>
	)
}

function ChatMessage(options) {
	const { message, onSuggest, evalMode, evalUser, evalInfo, user } = options
	const [localRows, setLocalRows] = useState(null)
	const [localColumns, setLocalColumns] = useState(null)
	const isAdmin = localStorage.getItem('isAdmin')
	const [enableDebug, setEnableDebug] = useState(!!localStorage.getItem('enableDebug'))

	async function handleRerunSQL(sql) {
		const resp = await fetch("/api/sql", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ sql }),
			credentials: "include",
		})
		const data = await resp.json()
		if (!data.error) {
			setLocalRows(data.rows || [])
			setLocalColumns(data.columns || [])
		}
	}

	function toggleDebug() {
		const next = !enableDebug
		if (next) {
			localStorage.setItem('enableDebug', '1')
		} else {
			localStorage.removeItem('enableDebug')
		}
		setEnableDebug(next)
	}

	if (message.role === "user") {
		return (
			<div className={"bubble-row user" + (evalUser ? " with-label" : "")}>
				{evalUser && <div className="eval-user-label">{evalUser}</div>}
				<div className="bubble bubble-user">
					{message.text}
				</div>
			</div>
		)
	}

	const enableNormalPlot = localStorage.getItem('enableNormalPlot')
	
	// assistant
	const { loading, error, sql, explanation, text, columns, rows, summary, key_takeaways, plot_config, no_plot, streaming_text, suggestions, msg_id, template_plots, rounds } = message.content
	const rawRows = localRows || rows || []
	const rawColumns = localColumns || columns || []
	// filter out rows where every value is empty
	const nonEmptyRows = rawRows.filter(function (row) {
		return rawColumns.some(function (col) {
			const v = row[col]
			return v !== null && v !== undefined && v !== ""
		})
	})
	// remove columns where all values are empty
	const displayColumns = rawColumns.filter(function (col) {
		return nonEmptyRows.some(function (row) {
			const v = row[col]
			return v !== null && v !== undefined && v !== ""
		})
	})
	const displayRows = nonEmptyRows
	// const showDebug = location.hostname === "localhost" || localStorage.getItem("debug") === "1"
	

	return (
		<div className="bubble-row assistant" style={{ position: "relative" }}>
			{isAdmin && (
				<button
					className={"debug-toggle" + (enableDebug ? " active" : "")}
					onClick={toggleDebug}
					title="Toggle debug"
				>Show Debug 🩺</button>
			)}
			<div className="bubble bubble-assistant">
				{message.content.preamble && <p className="preamble">{message.content.preamble}</p>}

				{enableDebug && rounds && rounds.map(function (r, i) {
					// infer which model produced this round from its label
					const label = r.label || ""
					const isHaiku = label === "Routing" || label === "Filter Resolution"
					const modelTag = isHaiku ? "haiku" : "sonnet"
					return (
						<details key={i} className="debug-round collapsible">
							<summary className="debug-round-label">
								{r.label}
								<span className={"round-model round-model-" + modelTag}>{modelTag}</span>
							</summary>
							{r.prompt && (
								<details className="collapsible"><summary>Prompt</summary><pre className="debug-pre" dangerouslySetInnerHTML={{ __html: highlightMarkdown(r.prompt) }} /></details>
							)}
							{r.messages && (
								<details className="collapsible"><summary>Messages</summary><pre className="debug-pre" dangerouslySetInnerHTML={{ __html: highlightJSON(r.messages) }} /></details>
							)}
							{r.response && (
								<details className="collapsible"><summary>Response</summary><pre className="debug-pre" dangerouslySetInnerHTML={{ __html: highlightMarkdown(r.response) }} /></details>
							)}

							{r.tool_calls && r.tool_calls.map(function (tc, ti) {
								const sql = tc.input && tc.input.sql ? tc.input.sql : JSON.stringify(tc.input)
								const rowTag = tc.rows !== undefined ? ` → ${tc.rows} rows` : ""
								return (
									<details key={ti} className="collapsible">
										<summary className="debug-tool-call">{tc.name}{rowTag}</summary>
										<pre className="debug-pre" dangerouslySetInnerHTML={{ __html: highlightMarkdown("```sql\n" + sql + "\n```") }} />
									</details>
								)
							})}

							{r.sql && (
								<SqlDisplay label="SQL" code={r.sql} explanation="" onRerun={handleRerunSQL} />
							)}
							{r.rows && r.rows.length > 0 && (
								<details className="collapsible"><summary>Data ({r.rows.length} rows)</summary><ResultTable columns={r.columns} rows={r.rows} /></details>
							)}
						</details>
					)
				})}

				{loading && (
					<div>
						<span className="loading-dots">Thinking</span>
						{streaming_text && <pre className="streaming-text">{streaming_text}</pre>}
					</div>
				)}
				{enableDebug && !loading && streaming_text && sql && (
					<details className="collapsible"><summary>Thinking</summary><pre className="streaming-text streaming-text-done">{streaming_text}</pre></details>
				)}

				{/* {error && <p className="no-data-msg">No data returned</p>} */}

				{/* conversational reply — show as markdown, no SQL block */}
				{text && !sql && <Markdown text={text} />}

				{enableDebug && sql && (
					<SqlDisplay label="SQL" code={sql} explanation={explanation} onRerun={handleRerunSQL} />
				)}

				{key_takeaways && key_takeaways.length > 0 && (
					<ul className="key-takeaways">
						{key_takeaways.map(function (t, i) {
							return <li key={i}>{t}</li>
						})}
					</ul>
				)}

				{summary && <Markdown text={summary} />}

				{enableNormalPlot && plot_config && !template_plots && (
					<ResultChart columns={displayColumns} rows={displayRows} plot_config={plot_config} msg_id={msg_id} />
				)}

				{enableDebug && displayRows && displayRows.length > 0 && (
					<details className="collapsible" open>
						<summary>Data ({displayRows.length} rows)</summary>
						<ResultTable columns={displayColumns} rows={displayRows} />
					</details>
				)}

				{template_plots && template_plots.length > 0 && rows && rows.length > 0 && (
					<TemplatePlots plots={template_plots} rows={rows} columns={displayColumns} />
				)}

				{!evalMode && suggestions && suggestions.length > 0 && (
					<div className="suggestion-chips">
						{suggestions.map(function (s, i) {
							return (
								<button
									key={i}
									className="suggestion-chip"
									onClick={function () { onSuggest({ prompt: s, backend: "claude" }) }}
								>
									{s}
								</button>
							)
						})}
					</div>
				)}

				{/* eval buttons for live chat */}
				{!evalMode && !loading && msg_id && <EvalBar msgId={msg_id} user={user} />}

				{/* read-only evals at same position */}
				{evalInfo && evalInfo.length > 0 && (
					<div className="eval-bar">
						{evalInfo.map(function (ev, ei) {
							return (
								<div key={ei} className="eval-saved-comment">
									<span className="eval-saved-user">
										{ev.user || "User"} {ev.rating === "good" ? "👍" : "👎"}
									</span>
									{ev.comment && <span className="eval-saved-text">{ev.comment}</span>}
								</div>
							)
						})}
					</div>
				)}
			</div>
		</div>
	)
}

export default ChatMessage
