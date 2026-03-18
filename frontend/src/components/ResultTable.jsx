const MAX_ROWS = 20

function ResultTable(options) {
    const { columns, rows } = options
    const displayRows = rows.slice(0, MAX_ROWS)
    const trimmed = rows.length > MAX_ROWS

    return (
        <div className="table-wrap">
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
                        {displayRows.map(function (row, i) {
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
            {trimmed && (
                <div className="table-note">Showing top {MAX_ROWS} of {rows.length} rows</div>
            )}
        </div>
    )
}

export default ResultTable
