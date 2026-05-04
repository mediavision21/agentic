import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, dirname, extname } from 'node:path'
import { load as yamlLoad } from 'js-yaml'
import { completeText } from './llm.js'
import { executeQuery } from './db.js'
import { saveLog } from './sqlite.js'
import { detectPlaceholders, loadFilterChoices } from './template_filters.js'

const TEMPLATE_DIR = join(import.meta.dirname, '..', 'template')

let _cache = null

function _readTemplatesRecursive(dir, baseDir) {
	const result = {}
	const entries = readdirSync(dir, { withFileTypes: true })
	for (const entry of entries) {
		const fullPath = join(dir, entry.name)
		if (entry.isDirectory() && entry.name !== 'new') {
			Object.assign(result, _readTemplatesRecursive(fullPath, baseDir))
		} else if (entry.isFile() && extname(entry.name) === '.yaml') {
			const rel = relative(baseDir, fullPath)
			try {
				const data = yamlLoad(readFileSync(fullPath, 'utf8'))
				const folder = dirname(rel)
				if (folder && folder !== '.') {
					data.category = folder
				}
				result[rel] = data
			} catch (e) {
				console.log(`[template_router] error loading ${rel}:`, e.message)
			}
		}
	}
	return result
}

export function loadTemplates() {
	if (_cache !== null) return _cache
	_cache = _readTemplatesRecursive(TEMPLATE_DIR, TEMPLATE_DIR)
	console.log(`[template_router] loaded ${Object.keys(_cache).length} templates`)
	return _cache
}

export function reloadTemplates() {
	_cache = null
	return loadTemplates()
}

const MATCH_SYSTEM_PROMPT = `You are a query router. Given a user question and a list of template descriptions, return the top 6 best matching templates with a similarity score from 0.0 to 1.0.

Format (one per line):
filename.yaml: 0.92
filename.yaml: 0.75
filename.yaml: 0.61

If no template is relevant at all, return NONE.
Return only the lines above, nothing else.`

export async function matchTopTemplates(prompt, templates) {
	const lines = Object.entries(templates).map(([fname, data]) => `- ${fname}: ${data.description || fname}`)
	const templateList = lines.join('\n')
	const messages = [{ role: 'user', content: `Templates:\n${templateList}\n\nUser question: ${prompt}` }]
	const debug = { prompt: MATCH_SYSTEM_PROMPT, messages, response: '' }
	try {
		const answer = await completeText({
			system: MATCH_SYSTEM_PROMPT,
			messages,
			model: 'haiku',
			max_tokens: 300,
			label: 'haiku-routing',
		})
		debug.response = answer
		console.log('[template_router] match result:\n' + answer)
		if (answer === 'NONE') return [[], debug]
		const results = []
		for (const line of answer.split('\n')) {
			const trimmed = line.trim()
			if (!trimmed) continue
			const parts = trimmed.split(':')
			if (parts.length < 2) continue
			const score = parseFloat(parts[parts.length - 1].trim())
			if (isNaN(score)) continue
			const fname = parts.slice(0, -1).join(':').trim()
			if (templates[fname]) {
				results.push({ file: fname, score })
			}
		}
		results.sort((a, b) => b.score - a.score)
		return [results.slice(0, 6), debug]
	} catch (e) {
		console.log('[template_router] match error:', e.message)
		return [[], debug]
	}
}

const TEMPLATE_SQL_PROMPT = `You are generating concrete SQL from a template.

Given the user's question, conversation history, and a SQL template with optional filter placeholders, produce a concrete executable SQL query.

Template placeholders use the syntax [[ AND {{name}} ]] — these are optional filters. Fill them using the available choices based on user intent:
- If the user specifies a value (e.g. "Sweden"), use that exact value from the choices list (case-insensitive).
- If the user does not specify, include all available choices using IN (...) syntax.
- For time periods: "last year" → most recent year in choices; "latest" → remove the time filter.
- Use conversation history to infer defaults (e.g. "same country as before" → reuse prior country).
- Strip the [[ ]] wrapper — output only valid SQL, no template syntax.

Return ONLY the final executable SQL query. No explanation, no markdown fences.`

export async function generateSqlFromTemplate(options) {
	const {
		prompt,
		template_sql: templateSql,
		placeholders = [],
		choices_map: choicesMap = {},
		history = [],
		description = '',
	} = options

	const lines = []
	if (description) lines.push(`Template purpose: ${description}`)
	lines.push(`\nTemplate SQL:\n${templateSql}`)
	if (placeholders.length > 0 && Object.keys(choicesMap).length > 0) {
		lines.push('\nAvailable choices for each placeholder:')
		for (const name of placeholders) {
			const choices = choicesMap[name] || []
			lines.push(`  ${name}: ${choices.map(String).join(', ')}`)
		}
	}
	for (const h of (history || []).slice(-3)) {
		if (h.role === 'assistant' && h.sql) {
			lines.push(`\nPrevious SQL for context:\n${h.sql}`)
			break
		}
	}
	lines.push(`\nUser question: ${prompt}`)
	lines.push('\nReturn ONLY the concrete executable SQL.')

	const messages = [{ role: 'user', content: lines.join('\n') }]
	const debug = { prompt: TEMPLATE_SQL_PROMPT, messages, response: '' }
	try {
		let sql = await completeText({
			system: TEMPLATE_SQL_PROMPT,
			messages,
			model: 'sonnet',
			max_tokens: 1000,
			label: 'template-sql-gen',
		})
		debug.response = sql
		sql = sql.trim().replace(/^```\w*\n?/, '').replace(/\n?```$/, '').trim()
		console.log('[template_router] generated sql:', sql.slice(0, 200))
		return [sql, debug]
	} catch (e) {
		console.log('[template_router] sql gen error:', e.message)
		debug.response = debug.response || `(error: ${e.message})`
		return [null, debug]
	}
}

export async function* runMatchedTemplate(options) {
	const {
		prompt,
		match,
		template,
		msg_id: msgId,
		user,
		conversation_id: conversationId,
		history = [],
	} = options

	const matchedFile = match.file
	const templateSql = (template.sql || '').trim()
	const description = template.description || matchedFile
	console.log(`[template_router] fast path: ${matchedFile} score=${match.score}`)

	const placeholders = detectPlaceholders(templateSql)
	let choicesMap = {}
	if (placeholders.length > 0) {
		const yamlFilters = template.filters || null
		choicesMap = await loadFilterChoices(placeholders, yamlFilters)
		console.log('[template_router] placeholders:', placeholders)
	}

	const [sql, genDebug] = await generateSqlFromTemplate({
		prompt,
		template_sql: templateSql,
		placeholders,
		choices_map: choicesMap,
		history,
		description,
	})
	yield { type: 'prompt', text: genDebug.prompt }
	yield { type: 'messages', messages: genDebug.messages }
	yield { type: 'response', text: genDebug.response || '(no response)' }

	if (!sql) {
		yield { type: 'error', error: 'Failed to generate SQL from template' }
		return
	}

	yield { type: 'sql', sql, plot_config: null, explanation: description }

	try {
		const data = await executeQuery(sql)
		yield { type: 'rows', columns: data.columns, rows: data.rows }
		saveLog(msgId, prompt, `[template] ${matchedFile}`, [], sql, 'template', {},
			user, conversationId, { columns: data.columns, rows: data.rows, plot_config: null })
	} catch (e) {
		console.log('[template_router] query error:', e.message)
		yield { type: 'error', error: `SQL error: ${e.message}` }
		saveLog(msgId, prompt, `[template] ${matchedFile}`, [], sql, 'template', {}, user, conversationId)
	}
}
