import { useMemo } from "react"
import MarkdownIt from "markdown-it"
import DOMPurify from "dompurify"

const md = new MarkdownIt({ breaks: true, linkify: true })

function renderBar(val, max) {
    const pct = max > 0 ? (parseFloat(val) / max) * 100 : 0
    return `<span class="mv-bar"><span class="mv-bar-fill" style="width:${pct}%"></span></span>`
}

function Markdown(options) {
    const { text } = options
    const html = useMemo(function () {
        const raw = md.render(text || "")
        const clean = DOMPurify.sanitize(raw, { ADD_ATTR: ["target"] })
        // Find max bar value first, then scale all bars relative to it
        const barRe = /%%BAR:([\d.]+)%%/g
        const vals = [...clean.matchAll(barRe)].map(m => parseFloat(m[1]))
        const max = vals.length > 0 ? Math.max(...vals) : 100
        return clean.replace(barRe, (_, val) => renderBar(val, max))
    }, [text])
    return <div className="md-body" dangerouslySetInnerHTML={{ __html: html }} />
}

export default Markdown
