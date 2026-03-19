import { useMemo } from "react"
import MarkdownIt from "markdown-it"

const md = new MarkdownIt({ breaks: true, linkify: true })

function Markdown(options) {
    const { text } = options
    const html = useMemo(function () { return md.render(text || "") }, [text])
    return <div className="md-body" dangerouslySetInnerHTML={{ __html: html }} />
}

export default Markdown
