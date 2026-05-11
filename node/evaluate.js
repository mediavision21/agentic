import Anthropic from '@anthropic-ai/sdk'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

// load ../.env if present (same as --env-file=../.env used by server.js)
try {
	const envPath = join(import.meta.dirname, '..', '.env')
	for (const line of readFileSync(envPath, 'utf8').split('\n')) {
		const m = line.match(/^([^#=\s][^=]*)=(.*)$/)
		if (m) process.env[m[1].trim()] ??= m[2].trim().replace(/^["']|["']$/g, '')
	}
} catch (_) {}
import yaml from 'js-yaml'
import { initPool, closePool } from './db.js'
import { probe } from './probe.js'

const client = new Anthropic({ apiKey: process.env.API_KEY })
const SONNET = 'claude-sonnet-4-6'
const TEMPLATE_DIR = join(import.meta.dirname, '..', 'template')

// ── template loading ──────────────────────────────────────────────────────────

function collectYamlFiles(dir) {
	const results = []
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry)
		const stat = statSync(full)
		if (stat.isDirectory()) {
			results.push(...collectYamlFiles(full))
		} else if (extname(entry) === '.yaml') {
			results.push(full)
		}
	}
	return results
}

function loadTemplatePicks() {
	const files = collectYamlFiles(TEMPLATE_DIR)
	const prompts = []
	for (const f of files) {
		if (prompts.length >= 5) break
		try {
			const doc = yaml.load(readFileSync(f, 'utf8'))
			if (doc && doc.description) prompts.push(doc.description)
		} catch (_) {}
	}
	return prompts
}

// ── criticize: pick best combo ────────────────────────────────────────────────

async function criticize(prompt, candidates) {
	const context = candidates.map((c, i) => {
		const key = `kpi_type=${c.kpi_type} kpi_dimension=${c.kpi_dimension ?? 'null'} service_id=${c.service_id ?? 'null'}`
		const preview = JSON.stringify(c.rows.slice(0, 5))
		return `Option ${i} — ${key}\nrows(${c.row_count}): ${preview}`
	}).join('\n\n')

	const msg = await client.messages.create({
		model: SONNET,
		max_tokens: 256,
		temperature: 0,
		system: 'You are a media data analyst. Given a user question and query result options, pick which option best answers the question. Return ONLY JSON: {"winner":0,"reason":"..."}',
		messages: [{
			role: 'user',
			content: `Question: ${prompt}\n\n${context}`,
		}],
	})
	const text = msg.content[0]?.text || '{}'
	try {
		const match = text.match(/\{[\s\S]*?\}/)
		return match ? JSON.parse(match[0]) : { winner: 0, reason: 'parse error' }
	} catch (_) {
		return { winner: 0, reason: 'parse error' }
	}
}

// ── evaluate one prompt ───────────────────────────────────────────────────────

async function runEval(prompt) {
	console.error(`[eval] prompt: ${prompt.slice(0, 70)}`)
	console.error('[eval] probing metric candidates...')
	const { answer_type, candidates } = await probe(prompt)
	console.error(`[eval] answer_type: ${answer_type}, candidates: ${candidates.length}`)
	candidates.forEach((c, i) => console.error(`[eval] candidate ${i}: kpi_type=${c.kpi_type} rows=${c.row_count}`))

	if (candidates.length === 0) {
		return { prompt, alternatives: [], winner: null, error: 'no candidates with data' }
	}

	console.error('[eval] criticizing...')
	const verdict = await criticize(prompt, candidates)
	console.error('[eval] verdict:', JSON.stringify(verdict))

	return {
		prompt,
		alternatives: candidates.map(c => ({
			answer_type,
			kpi_type: c.kpi_type,
			kpi_dimension: c.kpi_dimension,
			service_id: c.service_id,
			row_count: c.row_count,
			error: null,
			sample_rows: c.sample_rows,
		})),
		winner: {
			index: verdict.winner,
			reason: verdict.reason,
		},
	}
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
	console.error('[eval] connecting to db...')
	await initPool()
	console.error('[eval] db ready')

	const userPrompt = process.argv[2]
	const prompts = userPrompt ? [userPrompt] : loadTemplatePicks()
	console.error(`[eval] running ${prompts.length} prompt(s)`)

	const results = []
	for (const p of prompts) {
		results.push(await runEval(p))
	}

	const report = {
		generated_at: new Date().toISOString(),
		prompts: results,
	}

	process.stdout.write(yaml.dump(report, { lineWidth: 120, quotingType: '"' }))
	await closePool()
}

main().catch(e => {
	console.error('[eval] fatal:', e.message || e)
	console.error(e.stack)
	process.exit(1)
})
