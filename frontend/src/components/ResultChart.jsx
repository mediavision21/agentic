import { useRef, useEffect, useState } from "react"
import { highlightJSON } from "../highlight.js"
import { buildFromConfig, appendResponsiveSVG } from "../plotUtils.js"

function ResultChart(options) {
    const { columns, rows, plot_config, msg_id } = options
    const $container = useRef(null)
    const [activeConfig, setActiveConfig] = useState(plot_config)
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(() => plot_config ? JSON.stringify(plot_config, null, 2) : "")
    const [configError, setConfigError] = useState("")
    const [renderError, setRenderError] = useState("")
    const [saving, setSaving] = useState(false)

    useEffect(function () {
        setActiveConfig(plot_config)
        setDraft(plot_config ? JSON.stringify(plot_config, null, 2) : "")
        setConfigError("")
        setEditing(false)
    }, [plot_config])

    useEffect(function () {
        if (!$container.current || !activeConfig) return
        $container.current.innerHTML = ""
        setRenderError("")

        const hasConfig = activeConfig.marks && activeConfig.marks.length > 0
        if (!hasConfig) return

        const w = 700
        try {
            const chart = buildFromConfig({ config: activeConfig, rows, columns, width: w })
            if (chart) appendResponsiveSVG($container.current, chart)
        } catch (e) {
            console.error("[ResultChart] plot_config render failed", e)
            setRenderError(e.message)
        }
    }, [columns, rows, activeConfig])

    function handleReplot() {
        try {
            const parsed = JSON.parse(draft)
            setConfigError("")
            setActiveConfig(parsed)
            setEditing(false)
        } catch (e) {
            setConfigError(e.message)
        }
    }

    function handleSave() {
        if (!msg_id) return
        let parsed = activeConfig
        if (editing) {
            try {
                parsed = JSON.parse(draft)
                setConfigError("")
                setActiveConfig(parsed)
                setEditing(false)
            } catch (e) {
                setConfigError(e.message)
                return
            }
        }
        setSaving(false)
    }

    function openEdit(e) {
        e.preventDefault()
        setDraft(activeConfig ? JSON.stringify(activeConfig, null, 2) : "")
        setEditing(true)
    }

    function cancelEdit(e) {
        e.preventDefault()
        setEditing(false)
        setConfigError("")
    }

    return (
        <div>
            <div className="chart-container" ref={$container}></div>
            {renderError && <div className="code-error">Plot config render error: {renderError}</div>}
            {activeConfig && (
                <details className="collapsible">
                    <summary>Plot config</summary>
                    <div className="collapsible-body">
                        {editing ? (
                            <div className="code-edit-wrap">
                                <textarea
                                    className="code-textarea"
                                    value={draft}
                                    onChange={function (e) { setDraft(e.target.value) }}
                                    rows={Math.max(6, draft.split('\n').length + 1)}
                                    spellCheck={false}
                                />
                                {configError && <div className="code-error">{configError}</div>}
                                <div className="code-edit-actions">
                                    <button className="code-run-btn" onClick={handleReplot}>Replot</button>
                                    {msg_id && <button className="code-run-btn" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</button>}
                                    <button className="code-cancel-btn" onClick={cancelEdit}>Cancel</button>
                                </div>
                            </div>
                        ) : (
                            <div>
                                <div className="sql-block">
                                    <code dangerouslySetInnerHTML={{ __html: highlightJSON(activeConfig) }} />
                                </div>
                                <div className="code-edit-actions">
                                    <button className="code-inline-btn" onClick={openEdit}>edit</button>
                                    {msg_id && <button className="code-inline-btn" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "save"}</button>}
                                </div>
                            </div>
                        )}
                    </div>
                </details>
            )}
        </div>
    )
}

export default ResultChart
