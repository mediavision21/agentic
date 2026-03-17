import { useState } from "react"

function PromptInput(options) {
    const { onSubmit, loading } = options
    const [prompt, setPrompt] = useState("")
    const [backend, setBackend] = useState("claude")

    function handleSubmit(e) {
        e.preventDefault()
        if (prompt.trim() === "") return
        onSubmit({ prompt, backend })
    }

    return (
        <div className="section">
            <div className="backend-selector">
                <label>
                    <input
                        type="radio"
                        value="claude"
                        checked={backend === "claude"}
                        onChange={() => setBackend("claude")}
                    />
                    <span>Claude API</span>
                </label>
                <label>
                    <input
                        type="radio"
                        value="local"
                        checked={backend === "local"}
                        onChange={() => setBackend("local")}
                    />
                    <span>Local LLM</span>
                </label>
            </div>
            <form className="prompt-form" onSubmit={handleSubmit}>
                <input
                    className="prompt-input"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Ask a question about your data..."
                    disabled={loading}
                />
                <button
                    className="submit-btn"
                    type="submit"
                    disabled={loading || !prompt.trim()}
                >
                    Query
                </button>
            </form>
        </div>
    )
}

export default PromptInput
