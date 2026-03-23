import { useState } from "react"
import SqlDisplay from "./SqlDisplay.jsx"
import ResultTable from "./ResultTable.jsx"
import ResultChart from "./ResultChart.jsx"
import Markdown from "./Markdown.jsx"

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
            })
        }
    }

    async function submitComment() {
        await fetch("/api/evaluate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ msg_id: msgId, rating: "bad", comment, user: user || "" }),
        })
        setShowComment(false)
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
    const { message, onSuggest, evalMode, evalUser, user } = options

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
    const { loading, error, sql, explanation, text, columns, rows, summary, plot_config, streaming_text, suggestions, msg_id } = message.content

    return (
        <div className="bubble-row assistant">
            <div className="bubble bubble-assistant">
                {loading && !streaming_text && <span className="loading-dots">Thinking</span>}
                {streaming_text && (
                    loading
                        ? <pre className="streaming-text">{streaming_text}</pre>
                        : <details className="collapsible"><summary>Thinking</summary><pre className="streaming-text streaming-text-done">{streaming_text}</pre></details>
                )}

                {error && <p className="error-msg">{error}</p>}

                {/* conversational reply — show as markdown, no SQL block */}
                {text && !sql && <Markdown text={text} />}

                {sql && (
                    <SqlDisplay label="SQL" code={sql} explanation={explanation} />
                )}

                {rows && rows.length > 0 && (
                    <ResultTable columns={columns} rows={rows} />
                )}

                {rows && rows.length > 0 && (
                    <ResultChart columns={columns} rows={rows} plot_config={plot_config} />
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

                {/* eval buttons only when response is complete and we have an id, not in eval view */}
                {!evalMode && !loading && msg_id && <EvalBar msgId={msg_id} user={user} />}
            </div>
        </div>
    )
}

export default ChatMessage
