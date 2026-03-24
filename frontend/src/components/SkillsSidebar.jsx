import { useState, useEffect } from "react"

function formatTs(ts) {
    if (!ts) return ""
    return ts.replace("T", " ").slice(0, 19)
}

function SkillsSidebar(options) {
    const { activeSkill, onSelect, onSelectEval, activeEvalId, style, user } = options
    const [tab, setTab] = useState("skills")
    const [skills, setSkills] = useState([])
    const [evals, setEvals] = useState([])

    useEffect(function () {
        if (!user) return
        fetch("/api/skill-templates", { credentials: "include" })
            .then(function (r) { return r.json() })
            .then(function (d) { setSkills(d.files || []) })
    }, [user])

    function fetchEvals() {
        fetch("/api/evaluations", { credentials: "include" })
            .then(function (r) { return r.json() })
            .then(function (d) { setEvals(d.evaluations || []) })
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
                    onClick={function () { setTab("eval"); fetchEvals() }}
                >Eval</button>
            </div>
            {tab === "skills" && (
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
            )}
            {tab === "eval" && (
                <div className="skills-list">
                    {evals.length === 0 && (
                        <div className="skill-item eval-empty">No evaluations yet</div>
                    )}
                    {evals.map(function (ev) {
                        return (
                            <div
                                key={ev.id}
                                className={"skill-item eval-item" + (activeEvalId === ev.id ? " active" : "")}
                                onClick={function () { onSelectEval(ev) }}
                            >
                                <div className="eval-item-title">{ev.prompt || "—"}</div>
                                <div className="eval-item-meta">{ev.user || "User"} · {ev.rating}</div>
                                <div className="eval-item-ts">{formatTs(ev.timestamp)}</div>
                            </div>
                        )
                    })}
                </div>
            )}
        </aside>
    )
}

export default SkillsSidebar
