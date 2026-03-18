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
    const { loading, error, sql, explanation, system_prompt, columns, rows } = message.content

    return (
        <div className="bubble-row assistant">
            <div className="bubble bubble-assistant">
                {loading && <span className="loading-dots">Thinking</span>}

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
                    <ResultChart columns={columns} rows={rows} />
                )}
            </div>
        </div>
    )
}

export default ChatMessage
