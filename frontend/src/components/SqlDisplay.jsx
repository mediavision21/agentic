function SqlDisplay(options) {
    const { sql, explanation } = options

    return (
        <div className="section">
            <div className="section-title">Generated SQL</div>
            <div className="sql-block"><code>{sql}</code></div>
            {explanation && <div className="explanation">{explanation}</div>}
        </div>
    )
}

export default SqlDisplay
