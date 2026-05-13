// Usage: node node/migrate-result-data.js [--dry-run]
import { open, exec, query, run } from '../sqlite/index.js'
import { join } from 'node:path'

const DRY_RUN = process.argv.includes('--dry-run')
const DB_PATH = join(import.meta.dirname, '..', 'mediavision.db')
const db = open(DB_PATH)

function detectFormat(d) {
	if (d.msg_id !== undefined || d.streaming_text !== undefined || d.distilled_summary !== undefined) {
		return 'legacy'
	}
	if (d.msgId !== undefined) {
		return 'current'
	}
	if (d.summary !== undefined) {
		return 'old'
	}
	return 'bare'
}

function migrate(d) {
	const fmt = detectFormat(d)

	if (fmt === 'old') {
		// summary → report, keep columns/rows/plot_config
		return {
			...d,
			report: d.summary,
			answerType: 'trend',
		}
	}

	if (fmt === 'legacy') {
		// rename snake_case fields, pick best report source
		const out = { ...d }
		if (d.msg_id !== undefined) { out.msgId = d.msg_id; delete out.msg_id }
		if (d.user_prompt !== undefined) { out.userPrompt = d.user_prompt; delete out.user_prompt }
		if (d.streaming_text !== undefined) { out.streamingText = d.streaming_text; delete out.streaming_text }
		if (d.raw_text !== undefined) { out.rawText = d.raw_text; delete out.raw_text }
		out.report = d.distilled_summary ?? d.text ?? d.raw_text ?? d.streaming_text ?? ''
		out.answerType = 'text'
		return out
	}

	if (fmt === 'current') {
		// already modern shape — only patch if report is missing
		if (d.report) return d
		const reportText = d.summary ?? d.streamingText ?? null
		if (d.sql || (d.rows && d.rows.length > 0)) {
			return { ...d, report: reportText ?? '', answerType: d.answerType ?? 'table' }
		}
		if (reportText) {
			return { ...d, report: reportText, answerType: d.answerType ?? 'text' }
		}
		return d
	}

	// bare: only columns/rows/plot_config
	return {
		...d,
		report: 'Data retrieved.',
		answerType: 'table',
	}
}

const rows = query(db, `SELECT id, result_data FROM llm_logs WHERE result_data IS NOT NULL AND result_data != ''`, [])

const counts = { old: 0, legacy: 0, current: 0, bare: 0, skipped: 0, errors: 0 }
let updated = 0

for (const row of rows) {
	let data
	try {
		data = JSON.parse(row.result_data)
	} catch {
		counts.errors++
		continue
	}

	const fmt = detectFormat(data)
	counts[fmt]++

	const migrated = migrate(data)
	if (migrated === data) {
		counts.skipped++
		continue
	}

	if (!DRY_RUN) {
		run(db, `UPDATE llm_logs SET result_data = ? WHERE id = ?`, [JSON.stringify(migrated), row.id])
	}
	updated++
}

console.log('Format breakdown:', counts)
console.log(`Rows to update: ${updated}${DRY_RUN ? ' (dry run — no writes)' : ' (written)'}`)
