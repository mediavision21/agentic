import { useState, useRef, useEffect } from "react"
import PromptInput from "./components/PromptInput.jsx"
import ChatMessage from "./components/ChatMessage.jsx"

function App() {
    const [sessions, setSessions] = useState([{ id: 1, title: "New chat", messages: [] }])
    const [activeId, setActiveId] = useState(1)
    const [loading, setLoading] = useState(false)
    const $bottom = useRef(null)

    const currentSession = sessions.find(function (s) { return s.id === activeId })

    useEffect(function () {
        if ($bottom.current) {
            $bottom.current.scrollIntoView({ behavior: "smooth" })
        }
    }, [sessions, activeId])

    function newChat() {
        const id = Date.now()
        setSessions(function (prev) { return [...prev, { id, title: "New chat", messages: [] }] })
        setActiveId(id)
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
        // convert completed messages to history for the backend
        const history = []
        for (const msg of messages) {
            if (msg.role === "user") {
                history.push({ role: "user", text: msg.text })
            } else if (msg.role === "assistant" && msg.content && !msg.content.loading) {
                // send the raw LLM response text back as context
                const raw = msg.content.raw_text || msg.content.streaming_text || ""
                if (raw) history.push({ role: "assistant", text: raw })
            }
        }
        return history
    }

    async function handleSubmit(options) {
        const { prompt, backend } = options
        const sessionId = activeId

        const currentMessages = sessions.find(function (s) { return s.id === sessionId })?.messages || []
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
                // /sql command: run SQL directly, no LLM
                const resp = await fetch("/api/sql", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ sql: sqlMatch[1].trim() }),
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
                // streaming agent
                const resp = await fetch("/api/query", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ prompt, backend, history }),
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

                        if (event.type === "token") {
                            patchLastMsg(sessionId, function (c) {
                                return { ...c, streaming_text: (c.streaming_text || "") + event.text }
                            })
                        } else if (event.type === "text") {
                            // conversational reply — store raw_text, clear loading
                            patchLastMsg(sessionId, function (c) {
                                return { ...c, loading: false, text: event.text, raw_text: event.text }
                            })
                        } else if (event.type === "sql") {
                            patchLastMsg(sessionId, function (c) {
                                return { ...c, sql: event.sql, plot_config: event.plot_config, explanation: event.explanation, raw_text: c.streaming_text }
                            })
                        } else if (event.type === "rows") {
                            patchLastMsg(sessionId, function (c) {
                                return { ...c, loading: false, columns: event.columns, rows: event.rows }
                            })
                        } else if (event.type === "summary") {
                            patchLastMsg(sessionId, function (c) {
                                return { ...c, summary: event.text }
                            })
                        } else if (event.type === "suggestions") {
                            patchLastMsg(sessionId, function (c) {
                                return { ...c, suggestions: event.items }
                            })
                        } else if (event.type === "error") {
                            patchLastMsg(sessionId, function (c) {
                                return { ...c, loading: false, error: event.error }
                            })
                        }
                    }
                }
            }
        } catch (e) {
            console.error("query error", e)
            patchLastMsg(sessionId, function () {
                return { loading: false, error: e.message }
            })
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="app-layout">
            <aside className="sidebar">
                <div className="sidebar-top">
                    <div className="sidebar-logo">
                        <img src="/symbol-white.svg" height="28" alt="logo" />
                        <span className="sidebar-title">MediaVision</span>
                    </div>
                    <button className="new-chat-btn" onClick={newChat}>+ New chat</button>
                </div>
                <div className="sidebar-recents">
                    {sessions.map(function (s) {
                        return (
                            <div
                                key={s.id}
                                className={"session-item" + (s.id === activeId ? " active" : "")}
                                onClick={function () { setActiveId(s.id) }}
                            >
                                {s.title}
                            </div>
                        )
                    })}
                </div>
                <div className="sidebar-bottom">
                    <div className="account-row">
                        <div className="account-avatar">A</div>
                        <span>Account</span>
                    </div>
                </div>
            </aside>

            <main className="main-area">
                <div className="chat-window">
                    <div className="chat-messages">
                        {currentSession && currentSession.messages.map(function (msg, i) {
                            return <ChatMessage key={i} message={msg} onSuggest={handleSubmit} />
                        })}
                        <div ref={$bottom} />
                    </div>
                </div>
                <div className="chat-input-bar">
                    <PromptInput onSubmit={handleSubmit} loading={loading} />
                </div>
            </main>
        </div>
    )
}

export default App
