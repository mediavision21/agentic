import { useState, useRef, useEffect } from "react"
import PromptInput from "./components/PromptInput.jsx"
import ChatMessage from "./components/ChatMessage.jsx"
import SkillsSidebar from "./components/SkillsSidebar.jsx"
import SkillEditor from "./components/SkillEditor.jsx"
import EvalPanel from "./components/EvalPanel.jsx"
import LoginDialog from "./components/LoginDialog.jsx"
import parseRawResponse from "./parseResponse.js"

const DEFAULT_LEFT = 240
const DEFAULT_RIGHT = 240

function App() {
	function makeSessionId() {
		return Date.now() + "-" + Math.random().toString(36).slice(2, 6)
	}
	const [initialId] = useState(makeSessionId)
	const [sessions, setSessions] = useState([{ id: initialId, title: "New chat", messages: [] }])
	const [activeId, setActiveId] = useState(initialId)
	const [loading, setLoading] = useState(false)
	const [activeSkill, setActiveSkill] = useState(null)
	const [evalView, setEvalView] = useState(null) // {id, prompt, response, user, rating, comment}
	const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT)
	const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT)
	const [dragTarget, setDragTarget] = useState(null) // "left" | "right" | null
	const [user, setUser] = useState("")
	const [authChecked, setAuthChecked] = useState(false)
	const $bottom = useRef(null)

	const currentSession = sessions.find(function (s) { return s.id === activeId })

	// restore session from cookie on page load
	useEffect(function () {
		fetch("/api/me", { credentials: "include" })
			.then(function (r) { return r.json() })
			.then(function (data) {
				if (data.ok) {
					setUser(data.username)
				}
			})
			.finally(function () { setAuthChecked(true) })
	}, [])

	// fetch conversation history after login — replace sessions entirely
	useEffect(function () {
		if (user) {
			fetch("/api/conversations", { credentials: "include" })
				.then(function (r) { return r.json() })
				.then(function (data) {
					const history = (data.conversations || []).map(function (c) {
						return { id: c.id, title: c.title, messages: [], loaded: false }
					})
					const fresh = { id: makeSessionId(), title: "New chat", messages: [] }
					setSessions([...history, fresh])
					setActiveId(fresh.id)
				})
		}
	}, [user])

	useEffect(function () {
		if ($bottom.current) {
			$bottom.current.scrollIntoView({ behavior: "smooth" })
		}
	}, [sessions, activeId, evalView])

	function onLogin(username) {
		setUser(username)
	}

	function newChat() {
		const id = makeSessionId()
		setSessions(function (prev) { return [...prev, { id, title: "New chat", messages: [] }] })
		setActiveId(id)
		setEvalView(null)
	}

	async function loadConversation(id) {
		try {
			const [msgsResp, evalsResp] = await Promise.all([
				fetch("/api/conversations/" + id, { credentials: "include" }),
				fetch("/api/conversations/" + id + "/evaluations", { credentials: "include" }),
			])
			const msgsData = await msgsResp.json()
			const evalsData = await evalsResp.json()

			// index evaluations by log_id
			const evalsByLogId = {}
			for (const ev of evalsData.evaluations) {
				if (!evalsByLogId[ev.log_id]) evalsByLogId[ev.log_id] = []
				evalsByLogId[ev.log_id].push(ev)
			}

			const msgs = []
			for (const row of msgsData.messages) {
				let rd = null
				if (row.result_data) {
					try { rd = JSON.parse(row.result_data) } catch (e) { /* ignore */ }
				}
				msgs.push({ role: "user", text: row.prompt })
				msgs.push({
					role: "assistant",
					content: parseRawResponse(row.response, rd),
					evals: evalsByLogId[row.id] || null,
				})
			}
			setSessions(function (prev) {
				return prev.map(function (s) {
					if (s.id !== id) return s
					return { ...s, messages: msgs, loaded: true }
				})
			})
		} catch (e) {
			console.error("[loadConversation]", e)
		}
	}

	function selectSession(id) {
		setActiveId(id)
		setActiveSkill(null)
		setEvalView(null)

		const session = sessions.find(function (s) { return s.id === id })
		if (session && session.loaded === false) {
			loadConversation(id)
		}
	}

	function onSelectEval(ev) {
		setEvalView(ev)
		setActiveSkill(null)
	}

	function startDrag(options) {
		const { e, which } = options
		e.preventDefault()
		const startX = e.clientX
		const startW = which === "left" ? leftWidth : rightWidth
		setDragTarget(which)
		document.body.style.cursor = "col-resize"
		document.body.style.userSelect = "none"

		function onMove(moveE) {
			const delta = moveE.clientX - startX
			const newW = which === "left" ? startW + delta : startW - delta
			const snapped = newW < 50 ? 0 : newW
			if (which === "left") {
				setLeftWidth(snapped)
			} else {
				setRightWidth(snapped)
			}
		}

		function onUp() {
			setDragTarget(null)
			document.body.style.cursor = ""
			document.body.style.userSelect = ""
			document.removeEventListener("mousemove", onMove)
			document.removeEventListener("mouseup", onUp)
		}

		document.addEventListener("mousemove", onMove)
		document.addEventListener("mouseup", onUp)
	}

	function toggleLeft() {
		setLeftWidth(function (w) { return w > 0 ? 0 : DEFAULT_LEFT })
	}

	function toggleRight() {
		setRightWidth(function (w) { return w > 0 ? 0 : DEFAULT_RIGHT })
	}

	function patchLastMsg(sessionId, updater) {
		setSessions(function (prev) {
			return prev.map(function (s) {
				if (s.id !== sessionId) return s
				const msgs = [...s.messages]
				const last = msgs[msgs.length - 1]
				msgs[msgs.length - 1] = { ...last, content: updater(last.content) }
				return { ...s, messages: msgs }
			})
		})
	}

	function buildHistory(messages) {
		const history = []
		for (const msg of messages) {
			if (msg.role === "user") {
				history.push({ role: "user", text: msg.text })
			} else if (msg.role === "assistant" && msg.content && !msg.content.loading) {
				const raw = msg.content.raw_text || msg.content.streaming_text || ""
				if (raw) history.push({ role: "assistant", text: raw })
			}
		}
		return history
	}

	async function handleSubmit(options) {
		const { prompt, backend } = options
		const sessionId = activeId
		setEvalView(null)

		const currentSession_ = sessions.find(function (s) { return s.id === sessionId })
		const currentMessages = currentSession_?.messages || []
		const isFirstMessage = currentMessages.length === 0
		const history = buildHistory(currentMessages)

		const userMsg = { role: "user", text: prompt }
		const assistantMsg = { role: "assistant", content: { loading: true, streaming_text: "" } }

		setSessions(function (prev) {
			return prev.map(function (s) {
				if (s.id !== sessionId) return s
				const isFirst = s.messages.length === 0
				return {
					...s,
					title: isFirst ? prompt.slice(0, 40) : s.title,
					messages: [...s.messages, userMsg, assistantMsg],
				}
			})
		})
		setLoading(true)

		try {
			const sqlMatch = prompt.match(/^\/sql\s+([\s\S]+)/i)

			if (sqlMatch) {
				const resp = await fetch("/api/sql", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ sql: sqlMatch[1].trim() }),
					credentials: "include",
				})
				const data = await resp.json()
				console.log("[/sql] response", data)
				patchLastMsg(sessionId, function () {
					return {
						loading: false,
						error: data.error || "",
						sql: data.sql || "",
						explanation: "",
						plot_config: null,
						columns: data.columns || [],
						rows: data.rows || [],
						summary: "",
					}
				})
			} else {
				const resp = await fetch("/api/query", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ prompt, backend, history, session_id: String(sessionId) }),
					credentials: "include",
				})
				const reader = resp.body.getReader()
				const decoder = new TextDecoder()
				let buffer = ""

				while (true) {
					const { done, value } = await reader.read()
					if (done) break
					buffer += decoder.decode(value, { stream: true })
					const lines = buffer.split("\n")
					buffer = lines.pop()

					for (const line of lines) {
						if (!line.startsWith("data: ")) continue
						const event = JSON.parse(line.slice(6))
						console.log("[sse]", event.type, event)

						if (event.type === "msg_id") {
							patchLastMsg(sessionId, function (c) { return { ...c, msg_id: event.id } })
						} else if (event.type === "token") {
							patchLastMsg(sessionId, function (c) { return { ...c, streaming_text: (c.streaming_text || "") + event.text } })
						} else if (event.type === "text") {
							patchLastMsg(sessionId, function (c) { return { ...c, loading: false, text: event.text, raw_text: event.text } })
						} else if (event.type === "sql") {
							patchLastMsg(sessionId, function (c) { return { ...c, sql: event.sql, plot_config: event.plot_config, explanation: event.explanation, raw_text: c.streaming_text } })
						} else if (event.type === "rows") {
							patchLastMsg(sessionId, function (c) { return { ...c, loading: false, columns: event.columns, rows: event.rows } })
						} else if (event.type === "summary") {
							patchLastMsg(sessionId, function (c) { return { ...c, summary: event.text } })
						} else if (event.type === "suggestions") {
							patchLastMsg(sessionId, function (c) { return { ...c, suggestions: event.items } })
						} else if (event.type === "error") {
							patchLastMsg(sessionId, function (c) { return { ...c, loading: false, error: event.error } })
						}
					}
				}
			}
		} catch (e) {
			console.error("query error", e)
			patchLastMsg(sessionId, function () { return { loading: false, error: e.message } })
		} finally {
			setLoading(false)
			// persist conversation on first message
			if (isFirstMessage) {
				fetch("/api/conversations", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ id: String(sessionId), title: prompt.slice(0, 40) }),
					credentials: "include",
				})
			}
		}
	}

	// disable transition during drag to avoid lag
	const leftStyle = {
		minWidth: 0,
		overflow: "hidden",
		transition: dragTarget === "left" ? "none" : "width 0.2s ease",
		width: leftWidth,
	}
	const rightStyle = {
		minWidth: 0,
		overflow: "hidden",
		transition: dragTarget === "right" ? "none" : "width 0.2s ease",
		width: rightWidth,
	}

	// "skill-open" or "eval-open" drives the slide animation
	const panelClass = activeSkill ? " skill-open" : evalView ? " eval-open" : ""

	const userInitial = user ? user[0].toUpperCase() : "?"

	return (
		<div className="app-layout">
			{authChecked && !user && <LoginDialog onLogin={onLogin} />}

			<aside className="sidebar" style={leftStyle}>
				<div className="sidebar-top">
					<div className="sidebar-logo">
						<img src="/logotype-white.svg" height="20px" alt="logo" style={{ "paddingLeft": "5px" }} />
					</div>
					<button className="new-chat-btn" onClick={newChat}>+ New chat</button>
				</div>
				<div className="sidebar-recents">
					{sessions.map(function (s) {
						return (
							<div
								key={s.id}
								className={"session-item" + (s.id === activeId && !evalView ? " active" : "")}
								onClick={function () { selectSession(s.id) }}
							>
								{s.title}
							</div>
						)
					})}
				</div>
				<div className="sidebar-bottom">
					<div className="account-row">
						<div className="account-avatar">{userInitial}</div>
						<span>{user || "Account"}</span>
					</div>
				</div>
			</aside>

			{/* left drag handle */}
			<div
				className="sidebar-handle left-handle"
				onMouseDown={function (e) { startDrag({ e, which: "left" }) }}
			>
				<div className="handle"></div>
				<button className="sidebar-chevron" onClick={toggleLeft}>
					{leftWidth > 0 ? "‹" : "›"}
				</button>
			</div>

			<main className={"main-area" + panelClass}>
				<div className="chat-section">
					<div className="chat-window">
						<div className="chat-messages">
							{(currentSession ? currentSession.messages : []).map(function (msg, i) {
								return (
									<ChatMessage
										key={i}
										message={msg}
										onSuggest={handleSubmit}
										evalMode={false}
										evalUser={null}
										evalInfo={msg.evals || null}
										user={user}
									/>
								)
							})}
							<div ref={$bottom} />
						</div>
					</div>
					<div className="chat-input-bar">
						<PromptInput onSubmit={handleSubmit} loading={loading} />
					</div>
				</div>

				{/* skill editor panel — slides in from right when a skill is selected */}
				<div className="skill-panel">
					{activeSkill && (
						<SkillEditor name={activeSkill} onClose={function () { setActiveSkill(null) }} />
					)}
				</div>

				{/* eval panel — slides in from right when an eval is selected */}
				<div className="eval-panel">
					<EvalPanel evalView={evalView} onClose={function () { setEvalView(null) }} />
				</div>
			</main>

			{/* right drag handle */}
			<div
				className="sidebar-handle right-handle"
				onMouseDown={function (e) { startDrag({ e, which: "right" }) }}
			>
				<div className="handle"></div>
				<button className="sidebar-chevron" onClick={toggleRight}>
					{rightWidth > 0 ? "›" : "‹"}
				</button>
			</div>

			<SkillsSidebar
				style={rightStyle}
				activeSkill={activeSkill}
				onSelect={function (name) { setActiveSkill(name); setEvalView(null) }}
				onSelectEval={onSelectEval}
				activeEvalId={evalView ? evalView.id : null}
				user={user}
			/>
		</div>
	)
}

export default App
