import { useState } from "react"

function formatTs(ts) {
    if (!ts) return ""
    return ts.replace("T", " ").slice(0, 19)
}

function EvalSidebar(options) {
    const { onSelectEval, activeEvalId, style, user } = options
    const [evalSessions, setEvalSessions] = useState([])

    function fetchEvalSessions() {
        fetch("/api/evaluated-sessions", { credentials: "include" })
            .then(function (r) { return r.json() })
            .then(function (d) { setEvalSessions(d.sessions || []) })
    }

    return (
        <aside className="skills-sidebar" style={style}>
            <div className="skills-sidebar-tabs">
                <button
                    className="sidebar-tab active"
                    onClick={fetchEvalSessions}
                >Eval</button>
            </div>
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
        </aside>
    )
}

export default EvalSidebar
