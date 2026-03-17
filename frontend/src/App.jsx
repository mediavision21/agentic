import { useState } from "react"
import PromptInput from "./components/PromptInput.jsx"
import SqlDisplay from "./components/SqlDisplay.jsx"
import ResultTable from "./components/ResultTable.jsx"
import ResultChart from "./components/ResultChart.jsx"

function App() {
    const [sql, setSql] = useState("")
    const [explanation, setExplanation] = useState("")
    const [columns, setColumns] = useState([])
    const [rows, setRows] = useState([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState("")

    async function handleSubmit(options) {
        const { prompt, backend } = options
        setLoading(true)
        setError("")
        setSql("")
        setExplanation("")
        setColumns([])
        setRows([])

        try {
            const resp = await fetch("/api/query", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt, backend }),
            })
            const data = await resp.json()

            if (data.error) setError(data.error)
            if (data.sql) setSql(data.sql)
            if (data.explanation) setExplanation(data.explanation)
            if (data.columns) setColumns(data.columns)
            if (data.rows) setRows(data.rows)
        } catch (e) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div>
            <h1>MediaVision Analytics</h1>

            <PromptInput onSubmit={handleSubmit} loading={loading} />

            {loading && (
                <div className="section">
                    <span className="loading">Generating query</span>
                </div>
            )}

            {error && (
                <div className="section">
                    <p className="error-msg">{error}</p>
                </div>
            )}

            {sql && <SqlDisplay sql={sql} explanation={explanation} />}

            {rows.length > 0 && <ResultTable columns={columns} rows={rows} />}

            {rows.length > 0 && <ResultChart columns={columns} rows={rows} />}
        </div>
    )
}

export default App
