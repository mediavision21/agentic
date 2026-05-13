import { useMemo, useRef, useEffect } from "react"
import MarkdownIt from "markdown-it"
import DOMPurify from "dompurify"
import Cards from "./Card.jsx"
import { buildFromConfig, appendResponsiveSVG } from "../plotUtils.js"

const md = new MarkdownIt({ breaks: true, linkify: true })

function renderBar(val, max) {
	const pct = max > 0 ? (parseFloat(val) / max) * 100 : 0
	return `<span class="mv-bar"><span class="mv-bar-fill" style="width:${pct}%"></span></span>`
}

function renderMd(text) {
	const raw = md.render(text || "")
	const clean = DOMPurify.sanitize(raw, { ADD_ATTR: ["target"] })
	const barRe = /%%BAR:([\d.]+)%%/g
	const vals = [...clean.matchAll(barRe)].map(m => parseFloat(m[1]))
	const max = vals.length > 0 ? Math.max(...vals) : 100
	return clean.replace(barRe, (_, val) => renderBar(val, max))
}

function PlotBlock({ config, rows, columns }) {
	const $container = useRef(null)
	useEffect(function () {
		if (!$container.current || !rows || rows.length === 0) return
		$container.current.innerHTML = ""
		try {
			const chart = buildFromConfig({ config, rows, columns, width: 700 })
			if (chart) appendResponsiveSVG($container.current, chart)
		} catch (e) {
			console.error("[PlotBlock] render error:", e)
			$container.current.textContent = "Plot render error: " + e.message
		}
	}, [config, rows, columns])
	return <div className="chart-container" ref={$container}></div>
}

function parseSegments(text) {
	const segments = []
	// split on ```plot fences and %%CARDS%% blocks
	const re = /```plot\n([\s\S]*?)```|%%CARDS%%\n([\s\S]*?)%%\/CARDS%%/g
	let last = 0
	let match
	while ((match = re.exec(text)) !== null) {
		if (match.index > last) {
			segments.push({ type: 'md', text: text.slice(last, match.index) })
		}
		if (match[1] !== undefined) {
			try {
				const config = JSON.parse(match[1].trim())
				segments.push({ type: 'plot', config })
			} catch (_) {
				segments.push({ type: 'md', text: match[0] })
			}
		} else if (match[2] !== undefined) {
			const items = match[2].trim().split('\n').map(function (line) {
				const [label, value] = line.split('|').map(s => s.trim())
				return { label, value }
			}).filter(function (item) { return item.label && item.value })
			segments.push({ type: 'cards', items })
		}
		last = match.index + match[0].length
	}
	if (last < text.length) {
		segments.push({ type: 'md', text: text.slice(last) })
	}
	return segments
}

function Markdown({ text, rows, columns }) {
	const segments = useMemo(function () { return parseSegments(text || "") }, [text])
	return (
		<div className="md-body">
			{segments.map(function (seg, i) {
				if (seg.type === 'plot') {
					return <PlotBlock key={i} config={seg.config} rows={rows || []} columns={columns || []} />
				}
				if (seg.type === 'cards') {
					return <Cards key={i} items={seg.items} />
				}
				return <div key={i} dangerouslySetInnerHTML={{ __html: renderMd(seg.text) }} />
			})}
		</div>
	)
}

export default Markdown
