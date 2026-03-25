import { useState, useEffect } from "react"
import ChatMessage from "./ChatMessage.jsx"
import parseRawResponse from "../parseResponse.js"

function EvalPanel(options) {
    const { evalView, onClose } = options
    const [messages, setMessages] = useState([])

    useEffect(function () {
        if (!evalView) {
            setMessages([])
            return
        }

        async function load() {
            // fetch messages and evaluations in parallel
            const [msgsResp, evalsResp] = await Promise.all([
                fetch("/api/conversations/" + evalView.id, { credentials: "include" }),
                fetch("/api/conversations/" + evalView.id + "/evaluations", { credentials: "include" }),
            ])
            const msgsData = await msgsResp.json()
            const evalsData = await evalsResp.json()

            // index evaluations by log_id (multiple evals per message possible)
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
            setMessages(msgs)
        }
        load()
    }, [evalView])

    if (!evalView) return null

    return (
        <div className="eval-panel-content">
            <div className="eval-mode-banner">
                <button className="eval-mode-back" onClick={onClose}>← Back</button>
            </div>
            <div className="chat-window">
                <div className="chat-messages">
                    {messages.map(function (msg, i) {
                        return (
                            <ChatMessage
                                key={i}
                                message={msg}
                                onSuggest={function () {}}
                                evalMode={true}
                                evalUser={msg.role === "user" ? (evalView.user || "User") : null}
                                evalInfo={msg.evals || null}
                            />
                        )
                    })}
                </div>
            </div>
        </div>
    )
}

export default EvalPanel
