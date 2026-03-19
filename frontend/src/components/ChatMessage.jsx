import SqlDisplay from "./SqlDisplay.jsx"
import ResultTable from "./ResultTable.jsx"
import ResultChart from "./ResultChart.jsx"
import Markdown from "./Markdown.jsx"

function ChatMessage(options) {
    const { message, onSuggest } = options

    if (message.role === "user") {
        return (
            <div className="bubble-row user">
                <div className="bubble bubble-user">
                    {message.text}
                </div>
            </div>
        )
    }

    // assistant
    const { loading, error, sql, explanation, text, columns, rows, summary, plot_config, streaming_text, suggestions } = message.content

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

                {suggestions && suggestions.length > 0 && (
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
            </div>
        </div>
    )
}

export default ChatMessage
