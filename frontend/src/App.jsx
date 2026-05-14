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
	const [adminViewSession, setAdminViewSession] = useState(null)
	const $bottom = useRef(null)

	const currentSession = (adminViewSession && adminViewSession.id === activeId)
		? adminViewSession
		: sessions.find(function (s) { return s.id === activeId })

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
				setSessions([fresh, ...history])
				setActiveId(fresh.id)
			}
			loadUser()
			if (user === "rockie") {
				async function loadAdmin() {
					const r = await fetch("/api/admin/conversations", { credentials: "include" })
					const data = await r.json()
					console.log("[loadAdmin]", data)
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
		if (adminViewSession && adminViewSession.id === conv.id) {
			setActiveId(conv.id)
			setEvalView(null)
		} else {
			const stub = { id: conv.id, serverId: conv.id, title: conv.title || "Untitled", messages: [], loaded: false }
			setAdminViewSession(stub)
			setActiveId(conv.id)
			setEvalView(null)
			loadConversation(conv.id)
		}
	}

	function newChat() {
		const first = sessions[0]
		if (first && first.title === "New chat" && first.messages.length === 0) {
			setActiveId(first.id)
		} else {
			const id = makeSessionId()
			setSessions(function (prev) { return [{ id, title: "New chat", messages: [] }, ...prev] })
			setActiveId(id)
		}
		setEvalView(null)
		setTemplateView(null)
		setPlotEvalView(null)
		setAdminViewSession(null)
	}

	async function loadConversation(id) {
		try {
			const [msgsResp, evalsResp] = await Promise.all([
				fetch("/api/conversations/" + encodeURIComponent(id), { credentials: "include" }),
				fetch("/api/conversations/" + encodeURIComponent(id) + "/evaluations", { credentials: "include" }),
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
				msgs.push({ role: "user", text: (rd && (rd.userPrompt || rd.user_prompt)) || row.prompt })
				// new shape: result_data IS the full content object (same shape that
				// live streaming assembles in handleSubmit). detected by msgId (new)
				// or msg_id (legacy) presence — older rows fall back to parseRawResponse.
				let content
				if (rd && (rd.msgId || rd.msg_id)) {
					content = { ...rd, loading: false }
				} else {
					content = parseRawResponse(row.response, rd)
					content.msgId = row.id
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
			setAdminViewSession(function (prev) {
				if (prev && prev.id === id) {
					return { ...prev, messages: msgs, loaded: true }
				}
				return prev
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
		setAdminViewSession(null)

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
				const text = msg.content.distilledSummary
					|| msg.content.report
					|| msg.content.summary
					|| msg.content.rawText
					|| msg.content.streamingText
					|| ""
				const entry = { role: "assistant", text: text }
				// carry structured prior-turn context for follow-up continuation
				if (msg.content.sql) {
					entry.sql = msg.content.sql
				}
				if (msg.content.intent) {
					entry.intent = msg.content.intent
				}
				if (msg.content.plotConfig) {
					entry.plotConfig = msg.content.plotConfig
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
		const assistantMsg = { role: "assistant", content: { loading: true, streamingText: "" } }

		setSessions(function (prev) {
			const updated = prev.map(function (s) {
				if (s.id !== sessionId) return s
				const isFirst = s.messages.length === 0
				return {
					...s,
					title: isFirst ? prompt : s.title,
					messages: [...s.messages, userMsg, assistantMsg],
				}
			})
			const session = updated.find(function (s) { return s.id === sessionId })
			if (session) {
				return [session, ...updated.filter(function (s) { return s.id !== sessionId })]
			}
			return updated
		})
		setLoading(true)

		let modelTitle = null

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
						plotConfig: null,
						columns: data.columns || [],
						rows: data.rows || [],
						summary: "",
					}
				})
			} else {
				const resp = await fetch("/api/ask", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ prompt, history, sessionId: currentSession_?.serverId || "" }),
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

						if (event.type === "conversationId") {
							setSessions(function (prev) {
								return prev.map(function (s) {
									if (s.id !== sessionId) return s
									return { ...s, serverId: event.id }
								})
							})
						} else if (event.type === "msgId") {
							patchLastMsg(sessionId, function (c) { return { ...c, msgId: event.id } })
						} else if (event.type === "userPrompt") {
							// stored in content for history reload; no UI change needed live
						} else if (event.type === "preamble") {
							patchLastMsg(sessionId, function (c) { return { ...c, preamble: event.text } })
						} else if (event.type === "intent") {
							patchLastMsg(sessionId, function (c) { return { ...c, intent: event.intent } })
						} else if (event.type === "token") {
							patchLastMsg(sessionId, function (c) { return { ...c, streamingText: (c.streamingText || "") + event.text } })
						} else if (event.type === "text") {
							patchLastMsg(sessionId, function (c) { return { ...c, loading: false, text: event.text, rawText: event.text } })
						} else if (event.type === "sql") {
							patchLastMsg(sessionId, function (c) {
								const rounds = c.rounds ? c.rounds.slice() : []
								if (rounds.length > 0) rounds[rounds.length - 1] = { ...rounds[rounds.length - 1], sql: event.sql }
								return { ...c, sql: event.sql, plotConfig: event.plotConfig, explanation: event.explanation, rawText: c.streamingText, rounds }
							})
						} else if (event.type === "rows") {
							patchLastMsg(sessionId, function (c) {
								const rounds = c.rounds ? c.rounds.slice() : []
								if (rounds.length > 0) rounds[rounds.length - 1] = { ...rounds[rounds.length - 1], columns: event.columns, rows: event.rows }
								return { ...c, loading: false, columns: event.columns, rows: event.rows, rounds }
							})
						} else if (event.type === "report") {
							patchLastMsg(sessionId, function (c) { return { ...c, loading: false, report: event.text, answerType: event.answerType } })
						} else if (event.type === "suggestions") {
							patchLastMsg(sessionId, function (c) { return { ...c, suggestions: event.items } })
						} else if (event.type === "templatePlots") {
							patchLastMsg(sessionId, function (c) { return { ...c, templatePlots: event.plots } })
						} else if (event.type === "distilledSummary") {
							patchLastMsg(sessionId, function (c) { return { ...c, distilledSummary: event.text } })
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
						} else if (event.type === "title") {
							modelTitle = event.text
							if (isFirstMessage) {
								setSessions(function (prev) {
									return prev.map(function (s) {
										if (s.id !== sessionId) return s
										return { ...s, title: event.text }
									})
								})
							}
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
							body: JSON.stringify({ id: sess.serverId, title: (modelTitle || prompt).slice(0, 100) }),
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
	const enableSidebar = localStorage.getItem('enableSidebar')

	return (
		<div className="app-layout">
			{authChecked && !user && <LoginDialog onLogin={onLogin} />}

			<aside className="sidebar" style={leftStyle}>
				<div className="sidebar-top">
					<div className="sidebar-logo">
						<svg viewBox="0 0 902 109" fill="none" xmlns="http://www.w3.org/2000/svg" height="20px" style={{ paddingLeft: "5px" }}>
							<path d="M618.369 88.8935V19.4321H634.246L663.718 73.1159V19.4321H675.625V88.8935H659.748L630.277 34.9121V88.8935H618.369Z" fill="white"/>
							<path d="M569.082 89.8858C549.732 89.8858 535.84 76.4897 535.84 54.1628C535.84 31.8359 549.732 18.4398 569.082 18.4398C588.531 18.4398 602.423 31.8359 602.423 54.1628C602.423 76.4897 588.531 89.8858 569.082 89.8858ZM547.747 54.1628C547.747 69.9405 555.983 79.2682 568.586 79.2682H569.578C582.18 79.2682 590.516 69.9405 590.516 54.1628C590.516 38.3852 582.18 29.0575 569.578 29.0575H568.586C555.983 29.0575 547.747 38.3852 547.747 54.1628Z" fill="white"/>
							<path d="M507.855 88.8935V19.4321H519.763V88.8935H507.855Z" fill="white"/>
							<path d="M464.902 89.8858C446.941 89.8858 437.514 80.8558 437.018 65.9713H448.926C449.224 74.0089 455.177 79.2682 465.597 79.2682H466.589C474.825 79.2682 479.191 75.0012 479.191 69.9405C479.191 65.2766 476.711 62.4982 470.062 61.109L458.254 58.7274C446.346 56.2467 440.491 49.499 440.491 38.8813C440.491 28.2636 450.017 18.4398 466.192 18.4398C482.367 18.4398 491.992 27.569 492.19 40.8659H480.283C479.787 33.3244 474.031 29.0575 466.391 29.0575H465.398C457.46 29.0575 452.399 33.3244 452.399 38.4844C452.399 43.4459 455.376 46.0259 461.33 47.2167L472.047 49.3005C483.954 51.6821 491.099 57.9336 491.099 69.2459C491.099 81.2528 481.275 89.8858 464.902 89.8858Z" fill="white"/>
							<path d="M410.423 88.8935V19.4321H422.331V88.8935H410.423Z" fill="white"/>
							<path d="M356.245 88.8935L329.155 19.4321H342.253L364.183 76.8866L385.419 19.4321H398.219L371.725 88.8935H356.245Z" fill="white"/>
							<path d="M261.152 88.8935L288.639 19.4321H303.028L330.018 88.8935H317.515L310.966 71.9251H280.105L273.556 88.8935H261.152ZM284.174 61.2082H306.798L295.486 31.8359L284.174 61.2082Z" fill="white"/>
							<path d="M237.335 88.8935V19.4321H249.243V88.8935H237.335Z" fill="white"/>
							<path d="M163.134 88.8935V19.4321H187.445C207.589 19.4321 221.382 31.7367 221.382 54.1628C221.382 76.5889 207.887 88.8935 187.743 88.8935H163.134ZM175.041 78.2759H186.453C200.444 78.2759 209.474 71.3297 209.474 54.1628C209.474 36.9959 200.444 30.0498 186.453 30.0498H175.041V78.2759Z" fill="white"/>
							<path d="M94.9397 88.8935V19.4321H146.738V30.0498H106.847V47.9113H140.784V58.529H106.847V78.2759H147.73V88.8935H94.9397Z" fill="white"/>
							<path d="M0 88.8935V19.4321H19.0523L37.9061 76.3905L56.2637 19.4321H75.1175V88.8935H63.4083V31.3398L44.753 88.8935H30.8607L11.8084 31.6375V88.8935H0Z" fill="white"/>
							<g className="logo-circle-left">
								<circle cx="768.021" cy="54.163" r="54.163" fill="white"/>
							</g>
							<g className="logo-circle-right">
								<circle cx="830.149" cy="54.163" r="54.163" fill="none" stroke="#111" strokeWidth="20"/>
								<circle cx="830.149" cy="54.163" r="48" fill="none" stroke="white" strokeWidth="10"/>
							</g>
						</svg>
					</div>
					<button className="new-chat-btn" onClick={newChat}>+ New chat</button>
				</div>
				<div className="sidebar-recents">
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
													className={"session-item admin-user-conv" + (c.id === activeId && adminViewSession ? " active" : "")}
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
					<div className="admin-users-divider">Recent</div>
					{sessions.slice(0, 20).map(function (s) {
						return (
							<div
								key={s.id}
								className={"session-item" + (s.id === activeId && !adminViewSession && !evalView ? " active" : "")}
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

				{/* eval panel — slides in from right when an eval or template is selected */}
				<div className="eval-panel">
					{evalView && <EvalPanel evalView={evalView} onClose={function () { setEvalView(null) }} />}
					{templateView && <PlotPanel plotView={templateView} onClose={function () { setTemplateView(null) }} />}
					{plotEvalView && <PlotEvalPanel plotEvalView={plotEvalView} onClose={function () { setPlotEvalView(null) }} />}
				</div>
			</main>

			{/* right drag handle */
			enableSidebar && <div
					className="sidebar-handle right-handle"
					onMouseDown={function (e) { startDrag({ e, which: "right" }) }}
				>
					<div className="handle"></div>
					<button className="sidebar-chevron" onClick={toggleRight}>
						{rightWidth > 0 ? "›" : "‹"}
					</button>
				</div>
			}

			{
				enableSidebar &&  <EvalSidebar
					style={rightStyle}
					onSelectEval={onSelectEval}
					activeEvalId={evalView ? evalView.id : null}
					user={user}
					onSelectTemplate={onSelectTemplate}
					activeTemplateName={templateView ? templateView.name : null}
					onSelectPlotEval={onSelectPlotEval}
					activePlotEvalName={plotEvalView ? plotEvalView.name : null}
				/>
			}
		</div>
	)
}

export default App
