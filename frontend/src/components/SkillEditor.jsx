import { useState, useEffect, useRef } from "react"
import { highlightMarkdown } from "../highlight.js"

function SkillEditor(options) {
    const { name, onClose } = options
    const [content, setContent] = useState("")
    const [saved, setSaved] = useState(false)
    const $highlight = useRef(null)
    const $textarea = useRef(null)

    useEffect(function () {
        if (!name) return
        setSaved(false)
        fetch(`/api/skill-templates/${name}`, { credentials: "include" })
            .then(function (r) { return r.json() })
            .then(function (d) { setContent(d.content || "") })
    }, [name])

    function onScroll() {
        // keep highlight layer scroll in sync with textarea
        if ($highlight.current && $textarea.current) {
            $highlight.current.scrollTop = $textarea.current.scrollTop
            $highlight.current.scrollLeft = $textarea.current.scrollLeft
        }
    }

    function onChange(e) {
        setContent(e.target.value)
        setSaved(false)
    }

    async function onSave() {
        await fetch(`/api/skill-templates/${name}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content }),
            credentials: "include",
        })
        setSaved(true)
    }

    // append \n so highlight div matches textarea height exactly
    const highlighted = highlightMarkdown(content) + "\n"

    return (
        <div className="skill-editor">
            <div className="skill-editor-header">
                <span className="skill-editor-title">{name}</span>
                <button
                    className={"skill-save-btn" + (saved ? " saved" : "")}
                    onClick={onSave}
                >
                    {saved ? "Saved" : "Save"}
                </button>
                <button className="skill-close-btn" onClick={onClose}>✕</button>
            </div>
            <div className="editor-wrap">
                {/* syntax-highlighted layer rendered underneath */}
                <div
                    ref={$highlight}
                    className="editor-highlight"
                    aria-hidden="true"
                    dangerouslySetInnerHTML={{ __html: highlighted }}
                />
                {/* transparent textarea on top for editing */}
                <textarea
                    ref={$textarea}
                    className="editor-input"
                    value={content}
                    onChange={onChange}
                    onScroll={onScroll}
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                />
            </div>
        </div>
    )
}

export default SkillEditor
