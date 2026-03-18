// Collapsible code block used for SQL and system prompt
function SqlDisplay(options) {
    const { label, code, explanation } = options

    return (
        <details className="collapsible">
            <summary>{label}</summary>
            <div className="collapsible-body">
                <div className="sql-block"><code>{code}</code></div>
                {explanation && <div className="explanation">{explanation}</div>}
            </div>
        </details>
    )
}

export default SqlDisplay
