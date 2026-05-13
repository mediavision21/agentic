import { verifyAndGenerate } from './generate2.js'

export async function* summaryReport(options) {
	const {
		userPrompt,
		columns,
		rows,
		sql,
		answerType = 'text',
		priorPlotConfig,
		msgId,
		user = '',
		conversationId = '',
		sqlHistory = null,
		force = false,
	} = options

	const wantPlot = answerType === 'trend'
	yield { type: 'round', label: wantPlot ? 'Trend & Summary' : answerType === 'table' ? 'Table & Summary' : 'Summary' }

	const result = await verifyAndGenerate({
		userPrompt,
		columns,
		rows,
		sql,
		answerType,
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
		if (result.title) yield { type: 'title', text: result.title }
		if (result.report) yield { type: 'report', answerType: result.type, text: result.report }
		if ((result.suggestions || []).length > 0) yield { type: 'suggestions', items: result.suggestions }
	}

	yield { type: '_summary_status', ok: result.ok, reason: result.reason }
}
