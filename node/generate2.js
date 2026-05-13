import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { complete, completeText } from './llm.js'
import { executeQuery } from './db.js'
import { postprocessSql } from './sql_utils.js'
import { getSummaryPrompt } from './prompts.js'

const ONTOLOGY_PATH = join(import.meta.dirname, '..', 'skills', 'ONTOLOGY.md')
let _ontology = null
let _serviceIdToCanonical = undefined

export async function getServiceIdToCanonical() {
	if (_serviceIdToCanonical === undefined) {
		const result = await executeQuery(`SELECT service_id, canonical_name FROM macro.dim_service WHERE canonical_name IS NOT NULL`)
		_serviceIdToCanonical = Object.fromEntries(result.rows.map(r => [r.service_id, r.canonical_name]))
		console.log('[generate2] loaded service_id→canonical_name map:', Object.keys(_serviceIdToCanonical).length, 'entries')
	}
	return _serviceIdToCanonical
}

function getOntology() {
	if (!_ontology) {
		_ontology = readFileSync(ONTOLOGY_PATH, 'utf8')
	}
	return _ontology
}

const _SYSTEM_HEADER = `You are a SQL expert for Mediavision's media research database.
Generate a single SQL query that answers the user's question.
Return the SQL in a \`\`\`sql ... \`\`\` block.

**Never ask clarifying questions.** When kpi_type or other parameters are ambiguous, apply the defaults defined in the ontology and generate SQL immediately. The summary layer will offer follow-up suggestions to the user.

`

export async function buildSystemPrompt(options) {
	const {
		matches = [],
		templates = {},
		priorSql = null,
		templateFallbackFeedback = null,
		probe = null,
	} = options

	const parts = [_SYSTEM_HEADER + getOntology()]

	if (probe && probe.candidates && probe.candidates.length > 0) {
		parts.push('\n\n## Metric Probe — confirmed data exists for these combinations\n')
		parts.push(`Detected answer type: ${probe.answer_type}\n`)

		const goodCandadiates = probe.candidates.filter(c => c.row_count > 0)
		if (goodCandadiates.length) {
			parts.push('Prefer these combinations when writing SQL:')
			for (const c of goodCandadiates) {
				parts.push(`- kpi_type=${c.kpi_type} kpi_dimension=${c.kpi_dimension ?? 'null'} service_id=${c.service_id ?? 'null'} (${c.row_count} rows)\n`)

			}
		}

		const badCandadiates = probe.candidates.filter(c => c.row_count === 0)
		if (badCandadiates.length) {
			parts.push('Do NOT use these combinations when writing SQL, the result will be empty:')
			for (const c of badCandadiates) {
				parts.push(`- kpi_type=${c.kpi_type} kpi_dimension=${c.kpi_dimension ?? 'null'} service_id=${c.service_id ?? 'null'} (${c.row_count} rows)\n`)

			}
		}
	}

	if (priorSql) {
		parts.push('\n\n## Prior Turn Context (this is a follow-up — modify, do not replace)')
		parts.push('\nThe user is asking to modify the previous result. Adjust the SQL to incorporate their request ')
		parts.push(`while preserving the prior query's structure (e.g., add a period, filter, or column). `)
		parts.push('Keep the same kpi_type, services, countries, and grouping unless the user explicitly asks to change them.')
		parts.push('\n\nPrior SQL:\n```sql\n${priorSql}\n```')
	}
	if (templateFallbackFeedback) {
		parts.unshift(`## Context: A pre-built template was tried but failed: ${templateFallbackFeedback}. Generate SQL from scratch.\n\n`)
	}
	if (matches.length > 0 && Object.keys(templates).length > 0) {
		const exampleParts = []
		for (const m of matches.slice(0, 3)) {
			const t = templates[m.file]
			const desc = t.description || m.file
			const sql = (t.sql || '').trim()
			const scorePct = Math.round(m.score * 100)
			exampleParts.push(`### ${m.file} (similarity: ${scorePct}%)\nDescription: ${desc}\n\`\`\`sql\n${sql}\n\`\`\``)
		}
		parts.push(`\n\n## Similar templates for reference\nUse these as examples to guide your SQL style:\n\n${exampleParts.join('\n\n')}`)
	}
	return parts.join('')
}


export async function verifyAndGenerate(options) {
	const {
		userPrompt,
		columns,
		rows,
		sql,
		answerType = 'text',
		msgId,
		user = '',
		conversationId = '',
		priorPlotConfig,
		noPlot = false,
		sqlHistory = null,
		force = false,
	} = options

	if (!rows || rows.length === 0) {
		return { ok: false, reason: 'Query returned no rows', debug: {} }
	}

	const systemParts = [getSummaryPrompt()]
	if (force) {
		systemParts.push('\n\nIMPORTANT: You MUST return ok:true. Do not return ok:false. Provide your best-effort answer even if the data is imperfect. Note any limitations in the summary.')
	}
	const system = systemParts.join('')

	const sample = rows.slice(0, 50)
	const header = columns.join(', ')
	const dataLines = [header, ...sample.map(row => columns.map(c => row[c] === null || row[c] === undefined ? '' : String(row[c])).join(', '))]

	const dataParts = [`Answer type: ${answerType}\n\nQuery result:\n${dataLines.join('\n')}`]

	if (columns.includes('population_segment')) {
		const segMap = { viewers: 'actual viewers (not per-capita)', subscribers: 'subscribers only', users: 'active users', genre_viewers: 'genre-specific viewers' }
		const segs = [...new Set(rows.filter(r => r['population_segment']).map(r => String(r['population_segment'])))]
		if (segs.length > 0) dataParts.push(`\npopulation_segment: ${segs.map(s => `${s} (${segMap[s] || s})`).join(', ')} — mention this in your summary`)
	}
	if (priorPlotConfig) {
		const priorJson = JSON.stringify(priorPlotConfig, null, 2)
		dataParts.push('\n\nPrevious plot config (extend this — keep the same mark type and structure, just add/adjust fields for the new data):\n```json\n' + priorJson + '\n```')
	}
	if (noPlot) dataParts.push('\n\nNote: The user requested no visualization — return "plot": null.')
	const dataMsg = dataParts.join('')

	let messages
	if (sqlHistory) {
		messages = [...sqlHistory, { role: 'user', content: dataMsg }]
	} else {
		// Standalone call — include full context
		const userMsgParts = [`User question: ${userPrompt}\n\n${dataMsg}`]
		if (sql) userMsgParts.push(`\n\nSQL used:\n\`\`\`sql\n${sql}\n\`\`\``)
		messages = [{ role: 'user', content: userMsgParts.join('') }]
	}

	const debug = { prompt: system, messages, response: '' }
	try {
		const text = await completeText({
			system,
			messages,
			model: 'sonnet',
			label: 'verify-and-generate',
			msgId,
			user,
			conversationId,
		})
		debug.response = text
		const m = text.match(/```json\s*(.*?)\s*```/s)
		if (m) {
			try {
				const obj = JSON.parse(m[1].trim())
				if (!obj.ok) {
					return { ok: false, reason: obj.reason || "Data doesn't answer question", debug }
				}
				return {
					ok: true,
					type: obj.type || 'card',
					report: obj.report || null,
					suggestions: obj.suggestions || [],
					debug,
				}
			} catch (e) {
				console.log('[generate2] verifyAndGenerate parse error:', e.message)
			}
		}
		try {
			const obj = JSON.parse(text.trim())
			if (!obj.ok) {
				return { ok: false, reason: obj.reason || "Data doesn't answer question", debug }
			}
			return { ok: true, type: obj.type || 'card', report: obj.report || null, suggestions: obj.suggestions || [], debug }
		} catch (_) { }
		return { ok: true, type: 'card', report: text.slice(0, 500) || null, suggestions: [], debug }
	} catch (e) {
		console.log('[generate2] verifyAndGenerate error:', e.message)
		return { ok: true, plotConfig: null, summary: null, keyTakeaways: [], debug }
	}
}

export async function* openGeneration(options) {
	const {
		system,
		messages,
		label = 'Generation',
		msgId,
		user = '',
		conversationId = '',
	} = options

	const textChunks = []
	for await (const chunk of complete({
		system,
		messages,
		model: 'sonnet',
		label,
		msgId,
		user,
		conversationId,
	})) {
		if (chunk.type === 'token') {
			textChunks.push(chunk.text)
			process.stdout.write(chunk.text)
		}
		yield chunk
	}
	const fullText = textChunks.join('')
	process.stdout.write('\n')

	const sqlMatch = fullText.match(/```sql\s*([\s\S]*?)\s*```/)
	if (!sqlMatch) {
		const suggestions = []
		const suggMatch = fullText.match(/<!--suggestions\s*(.*?)\s*-->/s)
		if (suggMatch) {
			suggestions.push(...suggMatch[1].split('\n').map(l => l.trim()).filter(Boolean))
		}
		const displayText = fullText.replace(/\s*<!--suggestions.*?-->/gs, '').trim()
		if (displayText) yield { type: 'text', text: displayText }
		if (suggestions.length > 0) yield { type: 'suggestions', items: suggestions }
		yield { type: '_gen_result', kind: 'text', fullText }
		return
	}

	const sql = postprocessSql(sqlMatch[1].trim())
	console.log('[generate2] extracted sql →\n', sql)
	yield { type: '_gen_result', kind: 'sql', sql, fullText }
}

export default { buildSystemPrompt, verifyAndGenerate, openGeneration }
