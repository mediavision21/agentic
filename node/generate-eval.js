import { parseArgs } from 'node:util'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { dump as yamlDump } from 'js-yaml'
import { initPool, closePool, executeQuery } from './db.js'
import { loadTemplates } from './template_router.js'
import { completeText } from './llm.js'
// import generate from './generate.js'
import generate from './generate2.js'
import { postprocessSql } from './sql_utils.js'

const EVAL_OUTPUT = join(import.meta.dirname, '..', 'eval-output')

function parseCliArgs() {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			limit: { type: 'string', default: '5' },
			template: { type: 'string', default: '' },
		},
	})
	return { limit: parseInt(values.limit, 10), template: values.template || null }
}

function filterTemplates(templates, templateArg, limit) {
	const keys = Object.keys(templates)
	if (templateArg !== null) {
		if (/^\d+$/.test(templateArg)) {
			const idx = parseInt(templateArg, 10)
			return idx < keys.length ? [[keys[idx], templates[keys[idx]]]] : []
		}
		if (/^\d+-\d+$/.test(templateArg)) {
			const [start, end] = templateArg.split('-').map(Number)
			return keys.slice(start, end + 1).map(k => [k, templates[k]])
		}
		return keys.filter(k => k.includes(templateArg)).map(k => [k, templates[k]])
	}
	return keys.slice(0, limit).map(k => [k, templates[k]])
}

async function runPrompt(prompt) {
	const systemPrompt = await generate.buildSystemPrompt({})
	const messages = [{ role: 'user', content: prompt }]

	const text = await completeText({
		system: systemPrompt,
		messages,
		model: 'sonnet',
		label: 'generate-eval',
	})

	const sqlMatch = text.match(/```sql\s*([\s\S]*?)\s*```/)
	if (!sqlMatch) {
		return { prompt, ok: false, reason: 'no SQL generated', confidence: 0.0, row_count: 0, sql: null }
	}

	const sql = postprocessSql(sqlMatch[1].trim())
	console.log(`  sql: ${sql.slice(0, 120)}`)

	let columns, rows
	try {
		const result = await executeQuery(sql)
		columns = result.columns
		rows = result.rows
	} catch (e) {
		return { prompt, sql, ok: false, reason: `sql error: ${e.message}`, confidence: 0.0, row_count: 0 }
	}

	if (!rows || rows.length === 0) {
		return { prompt, sql, ok: false, reason: 'no rows returned', confidence: 0.0, row_count: 0 }
	}

	const verdict = await generate.verifyAndGenerate({ user_prompt: prompt, columns, rows })
	return {
		prompt,
		sql,
		ok: verdict.ok,
		reason: verdict.reason || '',
		confidence: verdict.ok ? 1.0 : 0.0,
		row_count: rows.length,
	}
}

async function main() {
	const { limit, template: templateArg } = parseCliArgs()

	await initPool()
	const templates = loadTemplates()
	const templateList = filterTemplates(templates, templateArg, limit)

	const results = []
	for (const [fname, tdata] of templateList) {
		const desc = tdata.description || fname
		console.log(`\n[eval] ${fname}`)
		console.log(`  prompt: ${desc}`)
		try {
			const result = await runPrompt(desc)
			result.template = fname
			results.push(result)
			const flag = result.ok ? 'ok' : 'FAIL'
			console.log(`  [${flag}] confidence=${result.confidence.toFixed(2)} rows=${result.row_count} — ${result.reason}`)
		} catch (e) {
			console.log(`  error: ${e.message}`)
			results.push({ template: fname, prompt: desc, ok: false, reason: String(e.message), confidence: 0.0, row_count: 0 })
		}
	}

	await closePool()

	const okCount = results.filter(r => r.ok).length
	const avgConf = results.length > 0 ? results.reduce((s, r) => s + r.confidence, 0) / results.length : 0.0
	console.log(`\n--- Summary: ${okCount}/${results.length} ok, avg confidence=${avgConf.toFixed(2)} ---`)

	mkdirSync(EVAL_OUTPUT, { recursive: true })
	const ts = new Date().toISOString().replace('T', '-').replace(/[:.]/g, '').slice(0, 15)
	const outPath = join(EVAL_OUTPUT, `generate-eval-${ts}.yaml`)

	const records = results.map(r => {
		const rec = {
			template: r.template || '',
			prompt: r.prompt || '',
			ok: r.ok,
			confidence: Math.round(r.confidence * 100) / 100,
			reason: r.reason || '',
			row_count: r.row_count || 0,
		}
		if (r.sql) rec.sql = r.sql
		return rec
	})

	const out = yamlDump(
		{ results: records, summary: { ok: okCount, total: results.length, avg_confidence: Math.round(avgConf * 100) / 100 } },
		{ lineWidth: -1, noRefs: true }
	)
	import('node:fs').then(({ writeFileSync }) => writeFileSync(outPath, out))
	console.log(`[yaml] ${outPath}`)
}

main().catch(e => { console.error(e); process.exit(1) })
