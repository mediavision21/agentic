import { completeText } from './llm.js'
import { getPlotPrompt } from './prompts.js'

export function extractPlotAndSummary(text) {
    console.log(`[plot] extract (${text.length} chars):`, JSON.stringify(text.slice(0, 120)))
    const m = text.match(/```json\s*(.*?)\s*```/s)
    if (m) {
        try {
            const obj = JSON.parse(m[1].trim())
            return [obj.plot || null, obj.summary || null, []]
        } catch (e) {
            console.log('[plot] parse error:', e.message)
        }
    }
    // LLM returned JSON without fences — try parsing raw text
    try {
        const obj = JSON.parse(text.trim())
        return [obj.plot || null, obj.summary || null, []]
    } catch (_) {}
    return [null, null, []]
}

function _buildSystemPrompt(promptData) {
    return promptData.header + promptData.examples
}

export async function generatePlotAndSummary(options) {
    const {
        user_prompt: userPrompt,
        columns,
        rows,
        sql,
        label = 'plot',
        log_id: logId,
        user = '',
        conversation_id: conversationId = '',
        prior_plot_config: priorPlotConfig,
        prompt_data: promptDataOverride,
    } = options

    const promptData = promptDataOverride || getPlotPrompt()
    const sample = rows.slice(0, 50)
    const header = columns.join(', ')
    const lines = [header, ...sample.map(row => columns.map(c => row[c] === null || row[c] === undefined ? '' : String(row[c])).join(', '))]
    let userMsg = `User question: ${userPrompt}\n\nQuery result: \n${lines.join('\n')}`
    if (sql) userMsg += `\n\nSQL used to produce this data:\n\`\`\`sql\n${sql}\n\`\`\``

    for (const kpiCol of ['kpi_dimension', 'kpi_type', 'kpi_service']) {
        if (columns.includes(kpiCol)) {
            const vals = [...new Set(rows.filter(r => r[kpiCol]).map(r => String(r[kpiCol])))]
            if (vals.length > 0) {
                userMsg += `\n${kpiCol} values: ${vals.join(', ')}`
            }
        }
    }

    if (priorPlotConfig) {
        const priorJson = JSON.stringify(priorPlotConfig, null, 2)
        userMsg += '\n\nPrevious plot config (extend this — keep the same mark type and structure, just add/adjust fields for the new data):\n```json\n' + priorJson + '\n```'
    }

    const systemPrompt = _buildSystemPrompt(promptData)
    const messages = [{ role: 'user', content: userMsg }]
    const text = await completeText({
        system: systemPrompt,
        messages,
        model: 'sonnet',
        label,
        log_id: logId,
        user,
        conversation_id: conversationId,
    })
    const [plot, summary, keyTakeaways] = extractPlotAndSummary(text)
    const debug = { prompt: systemPrompt, messages, response: text }
    return [plot, summary, keyTakeaways, debug]
}
