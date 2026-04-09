import { useState } from "react"
import { highlightSQL } from "../highlight.js"

// Collapsible code block used for SQL — supports edit + rerun
function SqlDisplay(options) {
    const { label, code, explanation, onRerun } = options
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(code)
    const [running, setRunning] = useState(false)

    function openEdit(e) {
        e.preventDefault()
        setDraft(code)
        setEditing(true)
    }

    function cancelEdit(e) {
        e.preventDefault()
        setEditing(false)
    }

    async function handleRun() {
        if (!onRerun) return
        setRunning(true)
        await onRerun(draft)
        setRunning(false)
        setEditing(false)
    }

    return (
        <details className="collapsible">
            <summary>{label}</summary>
            <div className="collapsible-body">
                {editing ? (
                    <div className="code-edit-wrap">
                        <textarea
                            className="code-textarea"
                            value={draft}
                            onChange={function(e) { setDraft(e.target.value) }}
                            rows={Math.max(4, draft.split('\n').length + 1)}
                            spellCheck={false}
                        />
                        <div className="code-edit-actions">
                            <button className="code-run-btn" onClick={handleRun} disabled={running}>
                                {running ? "running…" : "Run"}
                            </button>
                            <button className="code-cancel-btn" onClick={cancelEdit}>Cancel</button>
                        </div>
                    </div>
                ) : (
                    <div>
                        <div className="sql-block">
                            <code dangerouslySetInnerHTML={{ __html: highlightSQL(code) }} />
                        </div>
                        {onRerun && (
                            <div className="code-edit-actions">
                                <button className="code-inline-btn" onClick={openEdit}>edit</button>
                            </div>
                        )}
                    </div>
                )}
                {explanation && <div className="explanation">{explanation}</div>}
            </div>
        </details>
    )
}

export default SqlDisplay
