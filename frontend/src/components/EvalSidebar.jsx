import { useState, useEffect } from "react"

function formatTs(ts) {
	if (!ts) return ""
	return ts.replace("T", " ").slice(0, 19)
}

function TemplateCategory(options) {
	const { category, items, activeTemplateName, onSelectTemplate } = options
	const [open, setOpen] = useState(false)

	return (
		<div className="template-category">
			<div className="template-category-header" onClick={function () { setOpen(function (v) { return !v }) }}>
				<span className="template-category-arrow">{open ? "▾" : "▸"}</span>
				<span className="template-category-name">{category}</span>
				<span className="template-category-count">{items.length}</span>
			</div>
			{open && items.map(function (t) {
				const title = t.name.split('/').at(-1)
				return (
					<div
						key={t.name}
						className={"skill-item eval-item template-item" + (activeTemplateName === t.name ? " active" : "")}
						onClick={function () { onSelectTemplate(t) }}
					>
						<div className="eval-item-title">{title}</div>
						{t.description && <div className="eval-item-meta">{t.description}</div>}
					</div>
				)
			})}
		</div>
	)
}

function EvalSidebar(options) {
	const { onSelectEval, activeEvalId, style, user, onSelectTemplate, activeTemplateName, onSelectPlotEval, activePlotEvalName } = options
	const [tab, setTab] = useState("template")
	const [evalSessions, setEvalSessions] = useState([])
	const [templates, setTemplates] = useState([])
	const [plotEvalFiles, setPlotEvalFiles] = useState([])

	function fetchEvalSessions() {
		fetch("/api/evaluated-sessions", { credentials: "include" })
			.then(function (r) { return r.json() })
			.then(function (d) { setEvalSessions(d.sessions || []) })
	}

	function fetchTemplates() {
		fetch("/api/templates", { credentials: "include" })
			.then(function (r) { return r.json() })
			.then(function (d) { setTemplates(d.templates || []) })
	}

	function fetchPlotEvalFiles() {
		fetch("/eval/files")
			.then(function (r) { return r.json() })
			.then(function (d) { setPlotEvalFiles(d || []) })
	}

	useEffect(function () { fetchTemplates() }, [])

	function switchTab(name) {
		setTab(name)
		if (name === "eval" && evalSessions.length === 0) fetchEvalSessions()
		if (name === "ploteval" && plotEvalFiles.length === 0) fetchPlotEvalFiles()
	}

	// group templates by category preserving order of first appearance
	function groupByCategory(list) {
		const order = []
		const map = {}
		for (const t of list) {
			const cat = t.category || "uncategorized"
			if (!map[cat]) {
				map[cat] = []
				order.push(cat)
			}
			map[cat].push(t)
		}
		return order.map(function (cat) { return { cat, items: map[cat] } })
	}

	return (
		<aside className="skills-sidebar" style={style}>
			<div className="skills-sidebar-tabs">
				<button
					className={"sidebar-tab" + (tab === "eval" ? " active" : "")}
					onClick={function () { switchTab("eval") }}
				>Eval</button>
				<button
					className={"sidebar-tab" + (tab === "template" ? " active" : "")}
					onClick={function () { switchTab("template") }}
				>Template</button>
				<button
					className={"sidebar-tab" + (tab === "ploteval" ? " active" : "")}
					onClick={function () { switchTab("ploteval") }}
				>Plot Eval</button>
			</div>

			{tab === "eval" && (
				<div className="skills-list">
					{evalSessions.length === 0 && (
						<div className="skill-item eval-empty">No evaluations yet</div>
					)}
					{evalSessions.map(function (s) {
						return (
							<div
								key={s.id}
								className={"skill-item eval-item" + (activeEvalId === s.id ? " active" : "")}
								onClick={function () { onSelectEval(s) }}
							>
								<div className="eval-item-title">{s.title || "\u2014"}</div>
								<div className="eval-item-meta">{s.user} · {s.eval_count} eval{s.eval_count > 1 ? "s" : ""}</div>
								<div className="eval-item-ts">{formatTs(s.created_at)}</div>
							</div>
						)
					})}
				</div>
			)}

			{tab === "template" && (
				<div className="skills-list">
					{templates.length === 0 && (
						<div className="skill-item eval-empty">Loading...</div>
					)}
					{groupByCategory(templates).map(function (g) {
						return (
							<TemplateCategory
								key={g.cat}
								category={g.cat}
								items={g.items}
								activeTemplateName={activeTemplateName}
								onSelectTemplate={onSelectTemplate}
							/>
						)
					})}
				</div>
			)}

			{tab === "ploteval" && (
				<div className="skills-list">
					{plotEvalFiles.length === 0 && (
						<div className="skill-item eval-empty">No eval files found</div>
					)}
					{plotEvalFiles.map(function (name) {
						return (
							<div
								key={name}
								className={"skill-item eval-item" + (activePlotEvalName === name ? " active" : "")}
								onClick={function () { onSelectPlotEval(name) }}
							>
								<div className="eval-item-title">{name}</div>
							</div>
						)
					})}
				</div>
			)}
		</aside>
	)
}

export default EvalSidebar
