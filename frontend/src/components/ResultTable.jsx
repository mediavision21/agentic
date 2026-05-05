import { useState } from "react"

const DEFAULT_ROWS = 6

function ResultTable(options) {
    const { columns, rows } = options
    const [showAll, setShowAll] = useState(false)

    const hasMore = rows.length > DEFAULT_ROWS
    const visibleRows = showAll ? rows : rows.slice(0, DEFAULT_ROWS)

    return (
        <div className="table-wrap">
            <div className={showAll ? "table-wrap-scroll" : ""} style={{ overflowX: "auto" }}>
                <table className="result-table">
                    <thead>
                        <tr>
                            {columns.map(function (col) {
                                return <th key={col}>{col}</th>
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {visibleRows.map(function (row, i) {
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
            {hasMore && (
                <div className="chart-row-ctrl">
                    {!showAll && <span className="chart-row-note">Showing {DEFAULT_ROWS} of {rows.length} rows</span>}
                    <button className="code-inline-btn" onClick={function () { setShowAll(!showAll) }}>
                        {showAll ? "Show less" : "Show all rows"}
                    </button>
                </div>
            )}
        </div>
    )
}

export default ResultTable
