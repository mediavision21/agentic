import { useRef, useEffect, useState } from "react"

function LoginDialog(options) {
    const { onLogin } = options
    const $dialog = useRef(null)
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)

    useEffect(function () {
        $dialog.current.showModal()
    }, [])

    async function onSubmit(e) {
        e.preventDefault()
        const form = e.target
        const username = form.username.value
        const password = form.password.value
        setError("")
        setLoading(true)
        try {
            const resp = await fetch("/api/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password }),
            })
            const result = await resp.json()
            if (result.ok) {
                onLogin(result.username)
            } else {
                setError(result.error || "Login failed")
            }
        } catch (e) {
            setError("Network error")
        } finally {
            setLoading(false)
        }
    }

    return (
        <dialog ref={$dialog} className="login-dialog">
            <div className="login-header">
                <img src="/symbol-white.svg" height="32" alt="logo" />
                <span className="login-title">MediaVision</span>
            </div>
            <form onSubmit={onSubmit} className="login-form">
                <input name="username" type="text" className="login-input" placeholder="Username" autoFocus required />
                <input name="password" type="password" className="login-input" placeholder="Password" required />
                {error && <p className="login-error">{error}</p>}
                <button type="submit" className="login-btn" disabled={loading}>
                    {loading ? "Signing in…" : "Sign in"}
                </button>
            </form>
        </dialog>
    )
}

export default LoginDialog
