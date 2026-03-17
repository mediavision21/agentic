function ResultTable(options) {
    const { columns, rows } = options

    return (
        <div className="section">
            <div className="section-title">Results ({rows.length} rows)</div>
            <div style={{ overflowX: "auto" }}>
                <table className="result-table">
                    <thead>
                        <tr>
                            {columns.map(function (col) {
                                return <th key={col}>{col}</th>
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(function (row, i) {
                            return (
                                <tr key={i}>
                                    {columns.map(function (col) {
                                        return <td key={col}>{row[col]}</td>
                                    })}
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    )
}

export default ResultTable
