import ChatMessage from "./ChatMessage.jsx"

function EvalPanel(options) {
    const { evalView, onClose } = options

    if (!evalView) return null

    const messages = [
        { role: "user", text: evalView.prompt || "" },
        { role: "assistant", content: { loading: false, text: evalView.response || "", raw_text: evalView.response || "" } }
    ]

    return (
        <div className="eval-panel-content">
            <div className="eval-mode-banner">
                <button className="eval-mode-back" onClick={onClose}>← Back</button>
                <span className="eval-mode-user">{evalView.user || "User"}</span>
                <span className="eval-mode-rating">{evalView.rating}</span>
                {evalView.comment && <span className="eval-mode-comment">"{evalView.comment}"</span>}
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
                            />
                        )
                    })}
                </div>
            </div>
        </div>
    )
}

export default EvalPanel
