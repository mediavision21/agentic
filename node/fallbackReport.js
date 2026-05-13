import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.API_KEY })
const HAIKU = 'claude-haiku-4-5-20251001'

const CLARIFICATION_SYSTEM = `You are a media data analyst assistant. The user asked a question that is too vague to answer reliably because a key detail is missing (market, time period, metric, or service).

Ask exactly ONE specific follow-up question to resolve the ambiguity. Do not ask multiple questions.

Return ONLY this JSON, no explanation:
{"question": "...", "suggestions": ["option1", "option2", "option3"]}`

const NOT_AVAILABLE_SYSTEM = `You are a media data analyst assistant. The user asked a question but the required data does not exist in the dataset.

In one sentence, explain what data is missing. Then suggest the closest available alternative the user could ask about.

The dataset contains: reach, monthly reach, weekly reach, penetration, gross access, viewing time, spend, stacking, churn intention, account sharing — across Nordic markets (Sweden, Norway, Denmark, Finland) for streaming services.

Return ONLY this JSON, no explanation:
{"explanation": "...", "alternative": "...", "suggestions": ["alternative query 1", "alternative query 2"]}`

export async function* clarificationReport(prompt) {
	let question = 'Could you clarify which market, time period, metric, or service you are interested in?'
	let suggestions = []

	try {
		const msg = await client.messages.create({
			model: HAIKU,
			max_tokens: 300,
			temperature: 0,
			system: CLARIFICATION_SYSTEM,
			messages: [{ role: 'user', content: prompt }],
		})
		const text = msg.content[0]?.text || ''
		const match = text.match(/\{[\s\S]*\}/)
		if (match) {
			const obj = JSON.parse(match[0])
			if (obj.question) question = obj.question
			if (Array.isArray(obj.suggestions)) suggestions = obj.suggestions
		}
	} catch (_) {}

	const title = question.length > 60 ? question.slice(0, 57) + '...' : question
	const report = `### ${title}\n\n${question}`
	yield { type: 'report', answerType: 'clarification', text: report }
	if (suggestions.length > 0) yield { type: 'suggestions', items: suggestions }
}

export async function* notAvailableReport(prompt) {
	let explanation = 'The requested data is not available in the dataset.'
	let alternative = ''
	let suggestions = []

	try {
		const msg = await client.messages.create({
			model: HAIKU,
			max_tokens: 300,
			temperature: 0,
			system: NOT_AVAILABLE_SYSTEM,
			messages: [{ role: 'user', content: prompt }],
		})
		const text = msg.content[0]?.text || ''
		const match = text.match(/\{[\s\S]*\}/)
		if (match) {
			const obj = JSON.parse(match[0])
			if (obj.explanation) explanation = obj.explanation
			if (obj.alternative) alternative = obj.alternative
			if (Array.isArray(obj.suggestions)) suggestions = obj.suggestions
		}
	} catch (_) {}

	const body = alternative ? `${explanation} ${alternative}` : explanation
	const report = `### This data is not available in the dataset\n\n${body}`
	yield { type: 'report', answerType: 'not_available', text: report }
	if (suggestions.length > 0) yield { type: 'suggestions', items: suggestions }
}
