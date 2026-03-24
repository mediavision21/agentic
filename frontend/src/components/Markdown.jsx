import { useMemo } from "react"
import MarkdownIt from "markdown-it"
import DOMPurify from "dompurify"

const md = new MarkdownIt({ breaks: true, linkify: true })

function Markdown(options) {
    const { text } = options
    const html = useMemo(function () {
        const raw = md.render(text || "")
        return DOMPurify.sanitize(raw, { ADD_ATTR: ["target"] })
    }, [text])
    return <div className="md-body" dangerouslySetInnerHTML={{ __html: html }} />
}

export default Markdown
