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

    async function handleSubmit(options) {
        const { prompt, backend } = options

        const userMsg = { role: "user", text: prompt }
        const assistantMsg = { role: "assistant", content: { loading: true } }

        // Set title on first message
        setSessions(function (prev) {
            return prev.map(function (s) {
                if (s.id !== activeId) return s
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
            const resp = await fetch("/api/query", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt, backend }),
            })
            const data = await resp.json()
            console.log("query response", data)

            setSessions(function (prev) {
                return prev.map(function (s) {
                    if (s.id !== activeId) return s
                    const msgs = [...s.messages]
                    msgs[msgs.length - 1] = {
                        role: "assistant",
                        content: {
                            loading: false,
                            error: data.error || "",
                            sql: data.sql || "",
                            explanation: data.explanation || "",
                            system_prompt: data.system_prompt || "",
                            columns: data.columns || [],
                            rows: data.rows || [],
                        },
                    }
                    return { ...s, messages: msgs }
                })
            })
        } catch (e) {
            console.error("query error", e)
            setSessions(function (prev) {
                return prev.map(function (s) {
                    if (s.id !== activeId) return s
                    const msgs = [...s.messages]
                    msgs[msgs.length - 1] = { role: "assistant", content: { loading: false, error: e.message } }
                    return { ...s, messages: msgs }
                })
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
                            return <ChatMessage key={i} message={msg} />
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
