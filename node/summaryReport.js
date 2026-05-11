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
		prompt,
		columns,
		rows,
		sql,
		prior_plot_config: priorPlotConfig,
		log_id: logId,
		user = '',
		conversation_id: conversationId = '',
		sql_gen_messages: sqlGenMessages = null,
		force = false,
	} = options

	const wantPlot = needsPlot(prompt, columns, rows)
	yield { type: 'round', label: wantPlot ? 'Plot & Summary' : 'Summary' }

	const result = await verifyAndGenerate({
		user_prompt: prompt,
		columns,
		rows,
		sql,
		log_id: logId,
		user,
		conversation_id: conversationId,
		prior_plot_config: wantPlot ? priorPlotConfig : null,
		no_plot: !wantPlot,
		sql_gen_messages: sqlGenMessages,
		force,
	})

	const debug = result.debug || {}
	if (debug.prompt) yield { type: 'prompt', text: debug.prompt }
	if (debug.messages) yield { type: 'messages', messages: debug.messages }
	if (debug.response) yield { type: 'response', text: debug.response }

	if (result.ok) {
		const plotConfig = result.plot_config
		if (plotConfig && wantPlot) {
			yield { type: 'plot_config', plot_config: plotConfig }
		} else {
			yield { type: 'no_plot' }
		}
		if ((result.key_takeaways || []).length > 0) yield { type: 'key_takeaways', items: result.key_takeaways }
		if (result.summary) yield { type: 'summary', text: result.summary }
		if ((result.suggestions || []).length > 0) yield { type: 'suggestions', items: result.suggestions }
	} else {
		yield { type: 'no_plot' }
	}

	yield { type: '_summary_status', ok: result.ok, reason: result.reason }
}
