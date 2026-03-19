import SqlDisplay from "./SqlDisplay.jsx"
import ResultTable from "./ResultTable.jsx"
import ResultChart from "./ResultChart.jsx"

function ChatMessage(options) {
    const { message } = options

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
    const { loading, error, sql, explanation, system_prompt, columns, rows, summary, plot_config, streaming_text } = message.content

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

                {system_prompt && (
                    <SqlDisplay label="System prompt" code={system_prompt} />
                )}

                {sql && (
                    <SqlDisplay label="SQL" code={sql} explanation={explanation} />
                )}

                {rows && rows.length > 0 && (
                    <ResultTable columns={columns} rows={rows} />
                )}

                {rows && rows.length > 0 && (
                    <ResultChart columns={columns} rows={rows} plot_config={plot_config} />
                )}

                {summary && <p className="result-summary">{summary}</p>}
            </div>
        </div>
    )
}

export default ChatMessage
