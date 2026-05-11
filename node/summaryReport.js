import { verifyAndGenerate } from './generate2.js'

const _NO_PLOT_KEYWORDS = ['no chart', 'no plot', 'no graph', 'without chart', 'without plot',
	'no visualization', 'just numbers', 'just the data', 'text only']



export function needsPlot(prompt, columns, rows) {
	const p = prompt.toLowerCase()
	if (_NO_PLOT_KEYWORDS.some(k => p.includes(k))) return false
	if (!rows || rows.length <= 1) return false
	return true
}

export async function* summaryReport(options) {
	const {
		userPrompt,
		columns,
		rows,
		sql,
		priorPlotConfig,
		msgId,
		user = '',
		conversationId = '',
		sqlHistory = null,
		force = false,
	} = options

	const wantPlot = needsPlot(userPrompt, columns, rows)
	yield { type: 'round', label: wantPlot ? 'Plot & Summary' : 'Summary' }

	const result = await verifyAndGenerate({
		userPrompt,
		columns,
		rows,
		sql,
		msgId,
		user,
		conversationId,
		priorPlotConfig: wantPlot ? priorPlotConfig : null,
		noPlot: !wantPlot,
		sqlHistory,
		force,
	})

	const debug = result.debug || {}
	if (debug.prompt) yield { type: 'prompt', text: debug.prompt }
	if (debug.messages) yield { type: 'messages', messages: debug.messages }
	if (debug.response) yield { type: 'response', text: debug.response }

	if (result.ok) {
		const plotConfig = result.plotConfig
		if (plotConfig && wantPlot) {
			yield { type: 'plotConfig', plotConfig }
		} else {
			yield { type: 'noPlot' }
		}
		if ((result.keyTakeaways || []).length > 0) yield { type: 'keyTakeaways', items: result.keyTakeaways }
		if (result.summary) yield { type: 'summary', text: result.summary }
		if ((result.suggestions || []).length > 0) yield { type: 'suggestions', items: result.suggestions }
	} else {
		yield { type: 'noPlot' }
	}

	yield { type: '_summary_status', ok: result.ok, reason: result.reason }
}
