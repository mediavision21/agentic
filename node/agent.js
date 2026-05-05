import { updateResultData } from './sqlite.js'
import { loadTemplates, matchTopTemplates, runMatchedTemplate } from './template_router.js'
import { generatePlotAndSummary } from './plot.js'
import { needsPlot, run as generateRun } from './generate2.js'
import { saveTemplateFromContent } from './template_save.js'

function _makeTimestampId() {
	const now = new Date()
	const ts = now.toISOString().replace('T', ' ').slice(0, 19)
	const ns = (now.getMilliseconds() * 1000000).toString().padStart(9, '0')
	return `${ts}.${ns}`
}

// mirrors every SSE event into a single content dict — same shape the frontend
// assembles live in App.jsx handleSubmit. persisted at stream end for history replay.
export function _collect(event, content) {
	const t = event.type
	if (t === 'msg_id') {
		content.msg_id = event.id
	} else if (t === 'preamble') {
		content.preamble = event.text
	} else if (t === 'intent') {
		content.intent = event.intent
	} else if (t === 'token') {
		content.streaming_text = (content.streaming_text || '') + event.text
	} else if (t === 'text') {
		content.text = event.text
		content.raw_text = event.text
	} else if (t === 'sql') {
		content.sql = event.sql
		if (event.explanation) content.explanation = event.explanation
		if (event.plot_config !== undefined && event.plot_config !== null) content.plot_config = event.plot_config
		if (content.streaming_text) content.raw_text = content.streaming_text
		if (content.rounds.length > 0) content.rounds[content.rounds.length - 1].sql = event.sql
	} else if (t === 'rows') {
		content.columns = event.columns
		content.rows = event.rows
		if (content.rounds.length > 0) {
			content.rounds[content.rounds.length - 1].columns = event.columns
			content.rounds[content.rounds.length - 1].rows = event.rows
		}
	} else if (t === 'explanation') {
		content.explanation = event.text
	} else if (t === 'summary') {
		content.summary = event.text
	} else if (t === 'suggestions') {
		content.suggestions = event.items
	} else if (t === 'key_takeaways') {
		content.key_takeaways = event.items
	} else if (t === 'plot_config') {
		content.plot_config = event.plot_config
	} else if (t === 'no_plot') {
		content.no_plot = true
	} else if (t === 'template_plots') {
		content.template_plots = event.plots
	} else if (t === 'distilled_summary') {
		content.distilled_summary = event.text
	} else if (t === 'round') {
		content.rounds.push({ label: event.label })
	} else if (t === 'prompt') {
		if (content.rounds.length > 0) {
			content.rounds[content.rounds.length - 1].prompt = event.text
		}
	} else if (t === 'messages') {
		if (content.rounds.length > 0) {
			content.rounds[content.rounds.length - 1].messages = event.messages
		}
	} else if (t === 'response') {
		if (content.rounds.length > 0) {
			content.rounds[content.rounds.length - 1].response = event.text
		}
	} else if (t === 'tool_call') {
		if (content.rounds.length > 0) {
			const r = content.rounds[content.rounds.length - 1]
			if (!r.tool_calls) r.tool_calls = []
			r.tool_calls.push({ name: event.name, input: event.input, id: event.id })
		}
	} else if (t === 'tool_result') {
		if (content.rounds.length > 0) {
			const tc = (content.rounds[content.rounds.length - 1].tool_calls || []).find(c => c.id === event.id)
			if (tc) tc.rows = event.rows
		}
	} else if (t === 'user_prompt') {
		content.user_prompt = event.text
	} else if (t === 'error') {
		content.error = event.error
	}
}

// history is send from client side
export async function* generateAgentStream(prompt, history, options) {
	const { user = '', conversationId = '' } = options || {}
	const content = { loading: false, rounds: [] }
	try {
		for await (const event of _generateAgentStreamInner(prompt, history, user, conversationId)) {
			_collect(event, content)
			yield event
		}
	} finally {
		const msgId = content.msg_id
		if (msgId) {
			try {
				updateResultData(msgId, content)
			} catch (e) {
				console.log('[agent] persist content failed:', e.message)
			}
			if (content.sql && (content.plot_config || content.template_plots) && !content.error) {
				try {
					const path = saveTemplateFromContent(content)
					if (path) console.log('[agent] auto-saved template', path)
				} catch (e) {
					console.log('[agent] auto-save template failed:', e.message)
				}
			}
		}
	}
}

async function* _generateAgentStreamInner(prompt, history, user, conversationId) {
	const hist = history || []
	const convId = conversationId || _makeTimestampId()
	console.log(`[agent] start user=${user} convId=${convId} histLen=${hist.length}`)
	yield { type: 'conversation_id', id: convId }

	const msgId = _makeTimestampId()
	yield { type: 'msg_id', id: msgId }
	yield { type: 'user_prompt', text: prompt }

	// extract prior SQL from history for slow path context
	let priorSql = null
	let priorPlotConfig = null
	for (let i = hist.length - 1; i >= 0; i--) {
		const h = hist[i]
		if (h.role === 'assistant' && h.sql) {
			priorSql = h.sql
			priorPlotConfig = h.plot_config || null
			break
		}
	}

	// template matching
	const templates = loadTemplates()
	let matches = []
	if (Object.keys(templates).length > 0) {
		let matchDebug
		;[matches, matchDebug] = await matchTopTemplates(prompt, templates)
		yield { type: 'round', label: 'Routing' }
		yield { type: 'prompt', text: matchDebug.prompt }
		yield { type: 'messages', messages: matchDebug.messages }
		yield { type: 'response', text: matchDebug.response || '(no response)' }
	}

	if (matches.length > 0 && matches[0].score >= 0.95) {
		// fast path: template has high confidence score, just run query and generate summary
		yield { type: 'round', label: 'Template Execution' }
		let templateCols = null
		let templateRows = null
		let templateSql = null
		let gotError = false

		for await (const event of runMatchedTemplate({
			prompt,
			match: matches[0],
			template: templates[matches[0].file],
			msg_id: msgId,
			user,
			conversation_id: convId,
			history: hist,
		})) {
			if (event.type === 'rows') {
				templateCols = event.columns
				templateRows = event.rows
			} else if (event.type === 'sql') {
				templateSql = event.sql
			} else if (event.type === 'error') {
				gotError = true
			}
			yield event
		}

		if (!gotError && templateRows && templateRows.length > 0) {
			const wantPlot = needsPlot(prompt, templateCols, templateRows)
			yield { type: 'round', label: wantPlot ? 'Plot & Summary' : 'Summary' }
			if (wantPlot) {
				try {
					const [plotConfig, summary, kt, plotDebug] = await generatePlotAndSummary({
						user_prompt: prompt,
						columns: templateCols,
						rows: templateRows,
						sql: templateSql,
						label: 'template-plot',
						log_id: msgId,
						user,
						conversation_id: convId,
					})
					yield { type: 'prompt', text: plotDebug.prompt }
					yield { type: 'messages', messages: plotDebug.messages }
					yield { type: 'response', text: plotDebug.response }
					if (plotConfig) {
						yield { type: 'plot_config', plot_config: plotConfig }
					} else {
						yield { type: 'no_plot' }
					}
					if (kt && kt.length > 0) yield { type: 'key_takeaways', items: kt }
					if (summary) yield { type: 'summary', text: summary }
				} catch (e) {
					console.log('[agent] template plot error:', e.message)
					yield { type: 'no_plot' }
				}
			} else {
				yield { type: 'no_plot' }
			}
			return
		}
	}

	// slow path
	const slowLabel = matches.length > 0 ? 'Guided Generation' : 'Open Generation'

	console.log(`[agent] slow path label=${slowLabel} matches=${matches.length}`)
	for await (const event of generateRun({
		prompt,
		matches,
		templates,
		history: hist,
		msg_id: msgId,
		user,
		conversation_id: convId,
		intent_block: '',
		prior_sql: priorSql,
		prior_plot_config: priorPlotConfig,
		label: slowLabel,
		template_fallback_feedback: null,
	})) {
		yield event
	}
	console.log(`[agent] _generateAgentStreamInner done`)
}
