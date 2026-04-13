import { useState, useRef } from "react"

function PromptInput(options) {
	const { onSubmit, loading } = options
	// const [prompt, setPrompt] = useState("Quarterly trend of usage of on demand video playing country by country in nordic?")
	// const [prompt, setPrompt] = useState("what is the viewing time of the social video in nordics?")
	// const [prompt, setPrompt] = useState("how many people are watch youtube today?")
	// const [prompt, setPrompt] = useState("What is the reach of netflix across the nordics?")
	// const [prompt, setPrompt] = useState("Top services by SVOD penetration in in denmark (latest period)?")
	// const [prompt, setPrompt] = useState("Top five services side by side?")
	const [prompt, setPrompt] = useState("What is the development for FAST in the nordics?")
	const [backend, setBackend] = useState("claude")
	const $textarea = useRef(null)

	function handleInput(e) {
		setPrompt(e.target.value)
		// Auto-grow height
		const el = e.target
		el.style.height = "auto"
		el.style.height = el.scrollHeight + "px"
	}

	function handleSubmit(e) {
		e.preventDefault()
		if (prompt.trim() === "" || loading) return
		onSubmit({ prompt, backend })
		setPrompt("")
		if ($textarea.current) {
			$textarea.current.style.height = "auto"
		}
	}

	function handleKeyDown(e) {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault()
			handleSubmit(e)
		}
	}

	const canSend = prompt.trim() !== "" && !loading
	const showToggle = false
	return (
		<form className="prompt-box" onSubmit={handleSubmit}>
			<textarea
				ref={$textarea}
				className="prompt-textarea"
				value={prompt}
				onInput={handleInput}
				onChange={function (e) { setPrompt(e.target.value) }}
				onKeyDown={handleKeyDown}
				placeholder="Ask a question about your data..."
				disabled={loading}
				rows={1}
			/>
			<div className="prompt-footer">
				{showToggle ? <div className="backend-toggle">
					<label className={"backend-opt" + (backend === "claude" ? " selected" : "")}>
						<input type="radio" value="claude" checked={backend === "claude"} onChange={function () { setBackend("claude") }} />
						Claude
					</label>
					<label className={"backend-opt" + (backend === "local" ? " selected" : "")}>
						<input type="radio" value="local" checked={backend === "local"} onChange={function () { setBackend("local") }} />
						Local
					</label>
				</div> : <div />
				}
				<button
					className="send-btn"
					type="submit"
					disabled={!canSend}
					title="Send"
				>
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
						<path d="M8 13V3M8 3L3 8M8 3L13 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
				</button>
			</div>
		</form>
	)
}

export default PromptInput
