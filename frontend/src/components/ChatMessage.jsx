import { useState, useRef, useEffect } from "react"
import * as Plot from "@observablehq/plot"
import { highlightMarkdown, highlightJSON } from "../highlight.js"
import SqlDisplay from "./SqlDisplay.jsx"
import ResultTable from "./ResultTable.jsx"
import ResultChart from "./ResultChart.jsx"
import Markdown from "./Markdown.jsx"

// render a template plot by evaluating its Observable Plot code with data
function TemplatePlotView(options) {
	const { plot, rows } = options
	const $container = useRef(null)

	useEffect(function () {
		if (!$container.current || !rows || rows.length === 0) return
		$container.current.innerHTML = ""
		try {
			const code = "var data = __rows__;\n" + plot.code
			console.log(code)
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

function TemplatePlots(options) {
	const { plots, rows } = options
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
			{active && <TemplatePlotView plot={active} rows={rows} />}
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

	// assistant
	const { loading, error, sql, explanation, text, columns, rows, summary, plot_config, streaming_text, suggestions, msg_id, template_plots, stages } = message.content
	const displayColumns = localColumns || columns
	const displayRows = localRows || rows
	// const showDebug = location.hostname === "localhost" || localStorage.getItem("debug") === "1"
	const showDebug = true

	return (
		<div className="bubble-row assistant">
			<div className="bubble bubble-assistant">
				{showDebug && stages && stages.map(function (s, i) {
					return (
						<details key={i} className="debug-stage collapsible">
							<summary className="debug-stage-label">Stage {s.stage}: {s.label}</summary>
							{s.prompt && (
								<details className="collapsible"><summary>Prompt</summary><pre className="debug-pre" dangerouslySetInnerHTML={{ __html: highlightMarkdown(s.prompt) }} /></details>
							)}
							{s.messages && (
								<details className="collapsible"><summary>Messages</summary><pre className="debug-pre" dangerouslySetInnerHTML={{ __html: highlightJSON(s.messages) }} /></details>
							)}
							{s.response && (
								<details className="collapsible"><summary>Response</summary><pre className="debug-pre" dangerouslySetInnerHTML={{ __html: highlightMarkdown(s.response) }} /></details>
							)}
							{s.steps && s.steps.map(function (step, j) {
								return (
									<details key={j} className="debug-step collapsible">
										<summary>{step.label}</summary>
										{step.prompt && (
											<details className="collapsible"><summary>Prompt</summary><pre className="debug-pre" dangerouslySetInnerHTML={{ __html: highlightMarkdown(step.prompt) }} /></details>
										)}
										{step.messages && (
											<details className="collapsible"><summary>Messages</summary><pre className="debug-pre" dangerouslySetInnerHTML={{ __html: highlightJSON(step.messages) }} /></details>
										)}
										{step.response && (
											<details className="collapsible"><summary>Response</summary><pre className="debug-pre" dangerouslySetInnerHTML={{ __html: highlightMarkdown(step.response) }} /></details>
										)}
									</details>
								)
							})}
						</details>
					)
				})}
				{loading && (
					<div>
						<span className="loading-dots">Thinking</span>
						{streaming_text && <pre className="streaming-text">{streaming_text}</pre>}
					</div>
				)}
				{!loading && streaming_text && sql && (
					<details className="collapsible"><summary>Thinking</summary><pre className="streaming-text streaming-text-done">{streaming_text}</pre></details>
				)}

				{error && <p className="error-msg">{error}</p>}

				{message.content.preamble && <p className="preamble">{message.content.preamble}</p>}

				{/* conversational reply — show as markdown, no SQL block */}
				{text && !sql && <Markdown text={text} />}

				{sql && (
					<SqlDisplay label="SQL" code={sql} explanation={explanation} onRerun={handleRerunSQL} />
				)}

				{displayRows && displayRows.length > 0 && (
					<details className="collapsible">
						<summary>Data ({displayRows.length} rows)</summary>
						<ResultTable columns={displayColumns} rows={displayRows} />
					</details>
				)}

				{displayRows && displayRows.length > 0 && !template_plots && (
					<ResultChart columns={displayColumns} rows={displayRows} plot_config={plot_config} msg_id={msg_id} />
				)}

				{template_plots && template_plots.length > 0 && rows && rows.length > 0 && (
					<TemplatePlots plots={template_plots} rows={rows} />
				)}

				{summary && <Markdown text={summary} />}

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
