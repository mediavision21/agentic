import { updateResultData } from './sqlite.js'
import { loadTemplates, matchTopTemplates, runMatchedTemplate } from './template_router.js'
import { buildSystemPrompt, openGeneration, getServiceIdToCanonical } from './generate2.js'
import {validateColumnCardinality} from "./Cardinality.js"

import { saveTemplateFromContent } from './template_save.js'
import { metricProbe, MAX_ROWS } from './metricProbe.js'
import { summaryReport } from './summaryReport.js'
import { clarificationReport, notAvailableReport } from './fallbackReport.js'
import { executeQuery } from './db.js'
import { buildMessages } from './sql_utils.js'

const MAX_ATTEMPTS = 4
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
	if (t === 'msgId') {
		content.msgId = event.id
	} else if (t === 'preamble') {
		content.preamble = event.text
	} else if (t === 'intent') {
		content.intent = event.intent
	} else if (t === 'token') {
		content.streamingText = (content.streamingText || '') + event.text
	} else if (t === 'text') {
		content.text = event.text
		content.rawText = event.text
	} else if (t === 'sql') {
		content.sql = event.sql
		if (event.explanation) content.explanation = event.explanation
		if (event.plotConfig !== undefined && event.plotConfig !== null) content.plotConfig = event.plotConfig
		if (content.streamingText) content.rawText = content.streamingText
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
	} else if (t === 'keyTakeaways') {
		content.keyTakeaways = event.items
	} else if (t === 'plotConfig') {
		content.plotConfig = event.plotConfig
	} else if (t === 'noPlot') {
		content.noPlot = true
	} else if (t === 'answerType') {
		content.answerType = event.answerType
	} else if (t === 'clarification') {
		content.clarification = event.text
	} else if (t === 'cards') {
		content.cards = event.items
	} else if (t === 'templatePlots') {
		content.templatePlots = event.plots
	} else if (t === 'distilledSummary') {
		content.distilledSummary = event.text
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
	} else if (t === 'userPrompt') {
		content.userPrompt = event.text
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
		const msgId = content.msgId
		if (msgId) {
			try {
				updateResultData(msgId, content)
			} catch (e) {
				console.log('[agent] persist content failed:', e.message)
			}
			if (content.sql && (content.plotConfig || content.templatePlots) && !content.error) {
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

async function* _generateAgentStreamInner(userPrompt, history, user, conversationId) {
	const hist = history || []
	conversationId = conversationId || _makeTimestampId()
	console.log(`[agent] start user=${user} conversationId=${conversationId} histLen=${hist.length}`)
	yield { type: 'conversationId', id: conversationId }

	const msgId = _makeTimestampId()
	yield { type: 'msgId', id: msgId }
	yield { type: 'userPrompt', text: userPrompt }

	let priorSql = null
	let priorPlotConfig = null
	for (let i = hist.length - 1; i >= 0; i--) {
		const h = hist[i]
		if (h.role === 'assistant' && h.sql) {
			priorSql = h.sql
			priorPlotConfig = h.plotConfig || null
			break
		}
	}

	const templates = loadTemplates()
	const hasTemplates = Object.keys(templates).length > 0

	const [probeResult, matchResult] = await Promise.all([
		metricProbe(userPrompt),
		hasTemplates ? matchTopTemplates(userPrompt, templates) : Promise.resolve([[], null]),
	])
	console.log(`[agent] probe: answer_type=${probeResult.answer_type} answer_confidence=${probeResult.answer_confidence} candidates=${probeResult.candidates.length}`)

	if (probeResult.answer_type === 'clarification_needed') {
		for await (const e of clarificationReport(userPrompt)) yield e
		return
	}
	if (probeResult.answer_type === 'data_not_available') {
		for await (const e of notAvailableReport(userPrompt)) yield e
		return
	}

	const _PROBE_TO_DISPLAY = {
		ranking: 'table', comparison: 'table', distribution: 'table',
		trend: 'trend',
		text: 'text', correlation: 'text', market_overview: 'text',
	}
	const answerType = _PROBE_TO_DISPLAY[probeResult.answer_type] || 'text'
	yield { type: 'answerType', answerType }

	let matches = []
	if (matchResult[1]) {
		matches = matchResult[0]
		const matchDebug = matchResult[1]
		yield { type: 'round', label: 'Routing' }
		yield { type: 'prompt', text: matchDebug.prompt }
		yield { type: 'messages', messages: matchDebug.messages }
		yield { type: 'response', text: matchDebug.response || '(no response)' }
	}

	// fast path: template with high confidence score
	if (matches.length > 0 && matches[0].score >= 0.95) {
		yield { type: 'round', label: 'Template Execution' }
		let templateCols = null
		let templateRows = null
		let templateSql = null
		let gotError = false

		for await (const event of runMatchedTemplate({
			userPrompt,
			match: matches[0],
			template: templates[matches[0].file],
			msgId,
			user,
			conversationId,
			history: hist,
			probe: probeResult,
		})) {
			if (event.type === 'rows') { templateCols = event.columns; templateRows = event.rows }
			else if (event.type === 'sql') { templateSql = event.sql }
			else if (event.type === 'error') { gotError = true }
			yield event
		}

		if (!gotError && templateRows && templateRows.length > 0) {
			let summaryOk = false
			for await (const e of summaryReport({
				userPrompt, columns: templateCols, rows: templateRows, sql: templateSql,
				answerType, priorPlotConfig, msgId, user, conversationId,
			})) {
				if (e.type === '_summary_status') { summaryOk = e.ok; continue }
				yield e
			}
			if (summaryOk) return
		}
	}

	// median path: try all high-confidence probe candidates in confidence order
	const bestCandidates = probeResult.candidates
		.filter(c => c.answer_confidence >= 0.8 && c.row_count > 0 && c.row_count < MAX_ROWS)
		.sort((a, b) => b.answer_confidence - a.answer_confidence)

	const probeCols = ['period_date', 'country', 'kpi_type', 'kpi_dimension', 'service_id', 'age_group', 'value']
	for (let i = 0; i < bestCandidates.length; i++) {
		const candidate = bestCandidates[i]
		console.log(`[agent] median path [${i + 1}/${bestCandidates.length}]: answer_confidence=${candidate.answer_confidence} kpi_type=${candidate.kpi_type}`)
		yield { type: 'round', label: 'Probe Answer' }
		if (i === 0 && probeResult.llm_prompt) yield { type: 'prompt', text: probeResult.llm_prompt }
		if (i === 0 && probeResult.llm_response) yield { type: 'response', text: probeResult.llm_response }
		yield { type: 'sql', sql: candidate.sql }
		yield { type: 'rows', columns: probeCols, rows: candidate.rows }

		let summaryOk = false
		for await (const e of summaryReport({
			userPrompt, columns: probeCols, rows: candidate.rows, sql: candidate.sql,
			answerType, priorPlotConfig, msgId, user, conversationId,
		})) {
			if (e.type === '_summary_status') { summaryOk = e.ok; continue }
			yield e
		}
		if (summaryOk) return
	}

	// slow path: retry loop with SQL generation
	const slowLabel = matches.length > 0 ? 'Guided Generation' : 'Open Generation'
	console.log(`[agent] slow path label=${slowLabel} matches=${matches.length}`)

	const systemPrompt = await buildSystemPrompt({ matches, templates, priorSql, probe: probeResult })
	const messages = buildMessages(hist, userPrompt)
	let lastSql = null, lastColumns = null, lastRows = null, lastFailReason = null

	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		const roundLabel = attempt === 0 ? slowLabel : `Retry ${attempt}`
		let genResult = null
		for await (const e of openGeneration({
			system: systemPrompt, messages, label: roundLabel,
			msgId, user, conversationId,
		})) {
			if (e.type === '_gen_result') { genResult = e; continue }
			yield e
		}

		if (genResult.kind === 'text') return

		const { sql, fullText } = genResult
		let columns, rows
		try {
			const result = await executeQuery(sql)
			columns = result.columns
			rows = result.rows

			yield { type: 'sql', sql, plotConfig: null, explanation: '' }
			yield { type: 'rows', columns, rows }

			if (rows.length === 0) {
				lastFailReason = 'Query returned no rows'
				console.log('[agent] query returned 0 rows')
				yield { type: 'error', error: 'Query returned no rows' }
				messages.push(
					{ role: 'assistant', content: fullText },
					{ role: 'user', content: `## Revision Feedback\nThe query returned 0 rows. The data may not exist for these filter criteria. Try different filters, a different time period, or a different metric.\n\nWrite a new SQL query.` }
				)
				continue
			}

			const cardinalityCheck = validateColumnCardinality(columns, rows)
			rows = rows.map(r => Object.fromEntries(columns.map(col => [col, r[col]])))

			if (cardinalityCheck.ok) {
				if (columns.includes('service_id')) {
					const map = await getServiceIdToCanonical()
					columns = [...columns, 'canonical_name']
					rows = rows.map(r => ({ ...r, canonical_name: map[r.service_id] || null }))
				}
			} else {
				lastFailReason = cardinalityCheck.reason
				console.log('[agent] cardinality check failed:', cardinalityCheck.reason)
				yield { type: 'error', error: cardinalityCheck.reason }
				messages.push(
					{ role: 'assistant', content: fullText },
					{ role: 'user', content: `## Revision Feedback\n${cardinalityCheck.reason}\n\nRewrite the SQL to fix this.` }
				)
				continue
			}
		} catch (e) {
			console.log('[agent] query error:', e.message)
			lastFailReason = e.message
			yield { type: 'error', error: `SQL error: ${e.message}` }
			messages.push(
				{ role: 'assistant', content: fullText },
				{ role: 'user', content: `## Revision Feedback\nSQL error: ${e.message}\n\nFix the SQL and try again.` }
			)
			continue
		}

		const sqlHistory = [...messages, { role: 'assistant', content: fullText }]
		let summaryOk = false
		for await (const e of summaryReport({
			userPrompt, columns, rows, sql,
			answerType, priorPlotConfig, msgId, user, conversationId,
			sqlHistory,
		})) {
			if (e.type === '_summary_status') { summaryOk = e.ok; continue }
			yield e
		}
		if (summaryOk) return

		console.log(`[agent] attempt ${attempt + 1} verify failed`)
		lastSql = sql; lastColumns = columns; lastRows = rows
		lastFailReason = "Data doesn't answer the question"
		messages.push(
			{ role: 'assistant', content: fullText },
			{ role: 'user', content: `## Revision Feedback\nThe data does not answer the question.\n\nWrite a new SQL query.` }
		)
	}

	// best effort after exhausting retries
	if (lastColumns && lastRows) {
		for await (const e of summaryReport({
			userPrompt, columns: lastColumns, rows: lastRows, sql: lastSql,
			answerType, priorPlotConfig, msgId, user, conversationId,
			force: true,
		})) {
			if (e.type === '_summary_status') continue
			yield e
		}
	} else {
		const text = lastFailReason
			? `I was unable to find data that answers your question. ${lastFailReason}`
			: `I was unable to find data that answers your question after several attempts.`
		yield { type: 'summary', text }
	}

	console.log(`[agent] _generateAgentStreamInner done`)
}
