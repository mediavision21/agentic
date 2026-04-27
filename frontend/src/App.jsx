import { useState, useRef, useEffect } from "react"
import PromptInput from "./components/PromptInput.jsx"
import ChatMessage from "./components/ChatMessage.jsx"
import EvalSidebar from "./components/EvalSidebar.jsx"
import EvalPanel from "./components/EvalPanel.jsx"
import PlotPanel from "./components/PlotPanel.jsx"
import PlotEvalPanel from "./components/PlotEvalPanel.jsx"
import LoginDialog from "./components/LoginDialog.jsx"
import parseRawResponse from "./parseResponse.js"

const DEFAULT_LEFT = 240
const DEFAULT_RIGHT = 300

function App() {
	function makeSessionId() {
		return Date.now() + "-" + Math.random().toString(36).slice(2, 6)
	}
	const [initialId] = useState(makeSessionId)
	const [sessions, setSessions] = useState([{ id: initialId, title: "New chat", messages: [] }])
	const [activeId, setActiveId] = useState(initialId)
	const [loading, setLoading] = useState(false)
	const [evalView, setEvalView] = useState(null) // {id, prompt, response, user, rating, comment}
	const [templateView, setTemplateView] = useState(null)
	const [plotEvalView, setPlotEvalView] = useState(null)
	const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT)
	const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT)
	const [dragTarget, setDragTarget] = useState(null) // "left" | "right" | null
	const [user, setUser] = useState("")
	const [authChecked, setAuthChecked] = useState(false)
	const [adminGroups, setAdminGroups] = useState([]) // [{user, conversations}]
	const [expandedUsers, setExpandedUsers] = useState({})
	const $bottom = useRef(null)

	const currentSession = sessions.find(function (s) { return s.id === activeId })

	// restore session from cookie on page load
	useEffect(function () {
		async function check() {
			const r = await fetch("/api/me", { credentials: "include" })
			const data = await r.json()
			if (data.ok) {
				setUser(data.username)
			}
			setAuthChecked(true)
		}
		check()
	}, [])

	// fetch conversation history after login — replace sessions entirely
	useEffect(function () {
		if (user) {
			async function loadUser() {
				const r = await fetch("/api/conversations", { credentials: "include" })
				const data = await r.json()
				const history = (data.conversations || []).map(function (c) {
					return { id: c.id, serverId: c.id, title: c.title, messages: [], loaded: false }
				})
				const fresh = { id: makeSessionId(), title: "New chat", messages: [] }
				setSessions([...history, fresh])
				setActiveId(fresh.id)
			}
			loadUser()
			if (user === "rockie") {
				async function loadAdmin() {
					const r = await fetch("/api/admin/conversations", { credentials: "include" })
					const data = await r.json()
					setAdminGroups(data.groups || [])
				}
				loadAdmin()
			}
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

	function toggleUser(username) {
		setExpandedUsers(function (prev) {
			return { ...prev, [username]: !prev[username] }
		})
	}

	function openAdminConversation(conv) {
		// add to sessions if not already present, then select + load
		const existing = sessions.find(function (s) { return s.id === conv.id })
		if (existing) {
			selectSession(conv.id)
		} else {
			const stub = { id: conv.id, serverId: conv.id, title: conv.title || "Untitled", messages: [], loaded: false }
			setSessions(function (prev) { return [stub, ...prev] })
			setActiveId(conv.id)
			setEvalView(null)
			loadConversation(conv.id)
		}
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
				msgs.push({ role: "user", text: (rd && rd.user_prompt) || row.prompt })
				// new shape: result_data IS the full content object (same shape that
				// live streaming assembles in handleSubmit). detected by msg_id
				// presence — legacy rows lack it and fall back to parseRawResponse.
				let content
				if (rd && rd.msg_id) {
					content = { ...rd, loading: false }
				} else {
					content = parseRawResponse(row.response, rd)
					content.msg_id = row.id
				}
				msgs.push({
					role: "assistant",
					content,
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

	async function onSelectPlotEval(name) {
		setEvalView(null)
		setTemplateView(null)
		setPlotEvalView({ name, loading: true })
		const resp = await fetch("/eval/files/" + encodeURIComponent(name))
		const data = await resp.json()
		setPlotEvalView({ name, ...data, loading: false })
	}

	function selectSession(id) {
		setActiveId(id)
		setEvalView(null)
		setTemplateView(null)
		setPlotEvalView(null)

		const session = sessions.find(function (s) { return s.id === id })
		if (session && session.loaded === false) {
			loadConversation(id)
		}
	}

	function onSelectEval(ev) {
		setTemplateView(null)
		setPlotEvalView(null)
		setEvalView(ev)
	}

	async function onSelectTemplate(tpl) {
		setEvalView(null)
		setPlotEvalView(null)
		setTemplateView({ name: tpl.name, description: tpl.description, loading: true })
		try {
			const resp = await fetch("/api/templates/" + tpl.name, { credentials: "include" })
			const data = await resp.json()
			setTemplateView({ name: tpl.name, description: tpl.description, ...data, loading: false })
		} catch (e) {
			setTemplateView({ name: tpl.name, description: tpl.description, error: e.message, loading: false })
		}
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
		const all = []
		for (const msg of messages) {
			if (msg.role === "user") {
				all.push({ role: "user", text: msg.text })
			} else if (msg.role === "assistant" && msg.content && !msg.content.loading) {
				const text = msg.content.distilled_summary
					|| msg.content.summary
					|| msg.content.raw_text
					|| msg.content.streaming_text
					|| ""
				const entry = { role: "assistant", text: text }
				// carry structured prior-turn context for follow-up continuation
				if (msg.content.sql) {
					entry.sql = msg.content.sql
				}
				if (msg.content.intent) {
					entry.intent = msg.content.intent
				}
				if (msg.content.plot_config) {
					entry.plot_config = msg.content.plot_config
				}
				if (msg.content.columns) {
					entry.columns = msg.content.columns
				}
				if (text || entry.sql) {
					all.push(entry)
				}
			}
		}
		// keep last 5 exchanges (10 messages: 5 user + 5 assistant)
		if (all.length > 10) {
			return all.slice(all.length - 10)
		}
		return all
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
				const resp = await fetch("/api/ask", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ prompt, history, session_id: currentSession_?.serverId || "" }),
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

						if (event.type === "conversation_id") {
							setSessions(function (prev) {
								return prev.map(function (s) {
									if (s.id !== sessionId) return s
									return { ...s, serverId: event.id }
								})
							})
						} else if (event.type === "msg_id") {
							patchLastMsg(sessionId, function (c) { return { ...c, msg_id: event.id } })
						} else if (event.type === "user_prompt") {
							// stored in content for history reload; no UI change needed live
						} else if (event.type === "preamble") {
							patchLastMsg(sessionId, function (c) { return { ...c, preamble: event.text } })
						} else if (event.type === "intent") {
							patchLastMsg(sessionId, function (c) { return { ...c, intent: event.intent } })
						} else if (event.type === "token") {
							patchLastMsg(sessionId, function (c) { return { ...c, streaming_text: (c.streaming_text || "") + event.text } })
						} else if (event.type === "text") {
							patchLastMsg(sessionId, function (c) { return { ...c, loading: false, text: event.text, raw_text: event.text } })
						} else if (event.type === "sql") {
							patchLastMsg(sessionId, function (c) {
								const rounds = c.rounds ? c.rounds.slice() : []
								if (rounds.length > 0) rounds[rounds.length - 1] = { ...rounds[rounds.length - 1], sql: event.sql }
								return { ...c, sql: event.sql, plot_config: event.plot_config, explanation: event.explanation, raw_text: c.streaming_text, rounds }
							})
						} else if (event.type === "rows") {
							patchLastMsg(sessionId, function (c) {
								const rounds = c.rounds ? c.rounds.slice() : []
								if (rounds.length > 0) rounds[rounds.length - 1] = { ...rounds[rounds.length - 1], columns: event.columns, rows: event.rows }
								return { ...c, loading: false, columns: event.columns, rows: event.rows, rounds }
							})
						} else if (event.type === "summary") {
							patchLastMsg(sessionId, function (c) { return { ...c, summary: event.text } })
						} else if (event.type === "key_takeaways") {
							patchLastMsg(sessionId, function (c) { return { ...c, key_takeaways: event.items } })
						} else if (event.type === "suggestions") {
							patchLastMsg(sessionId, function (c) { return { ...c, suggestions: event.items } })
						} else if (event.type === "plot_config") {
							patchLastMsg(sessionId, function (c) { return { ...c, plot_config: event.plot_config } })
						} else if (event.type === "no_plot") {
							patchLastMsg(sessionId, function (c) { return { ...c, no_plot: true } })
						} else if (event.type === "template_plots") {
							patchLastMsg(sessionId, function (c) { return { ...c, template_plots: event.plots } })
						} else if (event.type === "distilled_summary") {
							patchLastMsg(sessionId, function (c) { return { ...c, distilled_summary: event.text } })
						} else if (event.type === "round") {
							// flat round: each round has prompt/messages/response; sql+plot distilled separately
							patchLastMsg(sessionId, function (c) {
								const rounds = (c.rounds || []).concat({ label: event.label })
								return { ...c, rounds }
							})
						} else if (event.type === "prompt") {
							patchLastMsg(sessionId, function (c) {
								const rounds = c.rounds || []
								if (rounds.length > 0) {
									rounds[rounds.length - 1].prompt = event.text
								}
								return { ...c, rounds: rounds.slice() }
							})
						} else if (event.type === "messages") {
							patchLastMsg(sessionId, function (c) {
								const rounds = c.rounds || []
								if (rounds.length > 0) {
									rounds[rounds.length - 1].messages = event.messages
								}
								return { ...c, rounds: rounds.slice() }
							})
						} else if (event.type === "response") {
							patchLastMsg(sessionId, function (c) {
								const rounds = c.rounds || []
								if (rounds.length > 0) {
									rounds[rounds.length - 1].response = event.text
								}
								return { ...c, rounds: rounds.slice() }
							})
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
				setSessions(function (prev) {
					const sess = prev.find(function (s) { return s.id === sessionId })
					if (sess && sess.serverId) {
						fetch("/api/conversations", {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ id: sess.serverId, title: prompt.slice(0, 40) }),
							credentials: "include",
						})
					}
					return prev
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

	const panelClass = (evalView || templateView || plotEvalView) ? " eval-open" : ""

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
					{adminGroups.length > 0 && (
						<div className="admin-users-section">
							<div className="admin-users-divider">Users</div>
							{adminGroups.filter(function (g) { return g.user !== user }).map(function (g) {
								const expanded = expandedUsers[g.user]
								return (
									<div key={g.user} className="admin-user-group">
										<div className="admin-user-header" onClick={function () { toggleUser(g.user) }}>
											<span className="admin-user-chevron">{expanded ? "▾" : "▸"}</span>
											<span className="admin-user-name">{g.user}</span>
											<span className="admin-user-count">{g.conversations.length}</span>
										</div>
										{expanded && g.conversations.map(function (c) {
											return (
												<div
													key={c.id}
													className="session-item admin-user-conv"
													onClick={function () { openAdminConversation(c) }}
												>
													{c.title || "Untitled"}
												</div>
											)
										})}
									</div>
								)
							})}
						</div>
					)}
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

				{/* eval panel — slides in from right when an eval or template is selected */}
				<div className="eval-panel">
					{evalView && <EvalPanel evalView={evalView} onClose={function () { setEvalView(null) }} />}
					{templateView && <PlotPanel plotView={templateView} onClose={function () { setTemplateView(null) }} />}
					{plotEvalView && <PlotEvalPanel plotEvalView={plotEvalView} onClose={function () { setPlotEvalView(null) }} />}
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

			<EvalSidebar
				style={rightStyle}
				onSelectEval={onSelectEval}
				activeEvalId={evalView ? evalView.id : null}
				user={user}
				onSelectTemplate={onSelectTemplate}
				activeTemplateName={templateView ? templateView.name : null}
				onSelectPlotEval={onSelectPlotEval}
				activePlotEvalName={plotEvalView ? plotEvalView.name : null}
			/>
		</div>
	)
}

export default App
