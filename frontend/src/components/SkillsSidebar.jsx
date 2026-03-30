import { useState, useEffect } from "react"

function formatTs(ts) {
	if (!ts) return ""
	return ts.replace("T", " ").slice(0, 19)
}

function SkillsSidebar(options) {
	const { activeSkill, onSelect, onSelectEval, activeEvalId, style, user } = options
	const [tab, setTab] = useState("skills")
	const [skills, setSkills] = useState([])
	const [evalSessions, setEvalSessions] = useState([])

	useEffect(function () {
		if (!user) return
		fetch("/api/skill-templates", { credentials: "include" })
			.then(function (r) { return r.json() })
			.then(function (d) { setSkills(d.files || []) })
	}, [user])

	function fetchEvalSessions() {
		fetch("/api/evaluated-sessions", { credentials: "include" })
			.then(function (r) { return r.json() })
			.then(function (d) { setEvalSessions(d.sessions || []) })
	}

	return (
		<aside className="skills-sidebar" style={style}>
			<div className="skills-sidebar-tabs">
				<button
					className={"sidebar-tab" + (tab === "skills" ? " active" : "")}
					onClick={function () { setTab("skills") }}
				>Skills</button>
				<button
					className={"sidebar-tab" + (tab === "eval" ? " active" : "")}
					onClick={function () { setTab("eval"); fetchEvalSessions() }}
				>Eval</button>
			</div>
			{/* {tab === "skills" && (
				<div className="skills-list">
					{skills.map(function (name) {
						return (
							<div
								key={name}
								className={"skill-item" + (activeSkill === name ? " active" : "")}
								onClick={function () { onSelect(name) }}
							>
								{name.replace(".md", "")}
							</div>
						)
					})}
				</div>
			)} */}
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
								<div className="eval-item-title">{s.title || "—"}</div>
								<div className="eval-item-meta">{s.user} · {s.eval_count} eval{s.eval_count > 1 ? "s" : ""}</div>
								<div className="eval-item-ts">{formatTs(s.created_at)}</div>
							</div>
						)
					})}
				</div>
			)}
		</aside>
	)
}

export default SkillsSidebar
