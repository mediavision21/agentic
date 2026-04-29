import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { complete, completeText } from './llm.js'
import { executeQuery } from './db.js'
import { updateResultData } from './sqlite.js'
import { postprocessSql, buildMessages } from './sql_utils.js'
import { getPlotPrompt } from './prompts.js'

const ONTOLOGY_PATH = join(import.meta.dirname, '..', 'skills', 'ONTOLOGY.md')
let _ontology = null

function getOntology() {
    if (!_ontology) {
        _ontology = readFileSync(ONTOLOGY_PATH, 'utf8')
    }
    return _ontology
}

const _SYSTEM_HEADER = `You are a SQL expert for Mediavision's media research database.
Generate a single SQL query that answers the user's question.
Return the SQL in a \`\`\`sql ... \`\`\` block.

`

const _NO_PLOT_KEYWORDS = ['no chart', 'no plot', 'no graph', 'without chart', 'without plot',
    'no visualization', 'just numbers', 'just the data', 'text only']

const _REQUIRED_COLS = ['period_date', 'country', 'kpi_type', 'kpi_dimension', 'service_id', 'age_group', 'value']
const _DIM_COLS = ['period_date', 'country', 'kpi_type', 'kpi_dimension', 'service_id', 'age_group']

function validateColumnCardinality(columns, rows) {
    const missing = _REQUIRED_COLS.filter(c => !columns.includes(c))
    if (missing.length > 0) {
        return { ok: false, reason: `SQL must SELECT these columns: ${missing.join(', ')}` }
    }
    const multiValueCols = _DIM_COLS.filter(col => {
        const vals = new Set(rows.map(r => r[col] === null ? '__null__' : String(r[col])))
        return vals.size > 1
    })
    if (multiValueCols.length > 2) {
        return {
            ok: false,
            reason: `Too many varying dimensions: ${multiValueCols.join(', ')}. At most 2 dimension columns may vary across rows. Add filters or GROUP BY to reduce the variation.`
        }
    }
    return { ok: true }
}

export function needsPlot(prompt, columns, rows) {
    const p = prompt.toLowerCase()
    if (_NO_PLOT_KEYWORDS.some(k => p.includes(k))) return false
    if (!rows || rows.length <= 1) return false
    return true
}

export async function buildSystemPrompt(options) {
    const {
        matches = [],
        templates = {},
        priorSql = null,
        templateFallbackFeedback = null,
    } = options

    let base = _SYSTEM_HEADER + getOntology()

    if (priorSql) {
        base += '\n\n## Prior Turn Context (this is a follow-up — modify, do not replace)'
        base += '\nThe user is asking to modify the previous result. Adjust the SQL to incorporate their request '
        base += 'while preserving the prior query\'s structure (e.g., add a period, filter, or column). '
        base += 'Keep the same kpi_type, services, countries, and grouping unless the user explicitly asks to change them.'
        base += `\n\nPrior SQL:\n\`\`\`sql\n${priorSql}\n\`\`\``
    }
    if (templateFallbackFeedback) {
        base = `## Context: A pre-built template was tried but failed: ${templateFallbackFeedback}. Generate SQL from scratch.\n\n` + base
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
        base += `\n\n## Similar templates for reference\nUse these as examples to guide your SQL style:\n\n${exampleParts.join('\n\n')}`
    }
    return base
}


const _VERIFY_AND_GENERATE_PREFIX = `You are verifying query results and generating a visualization.

First check: does this data answer the user's question?
- If the data is clearly wrong (wrong metric entirely, asked for entity X but no rows for X, clearly wrong time period when user specified one), return ONLY:
  \`\`\`json
  {"ok": false, "reason": "brief explanation"}
  \`\`\`
- Otherwise (even if partial or approximate), generate the visualization below.

When generating, return ONLY a \`\`\`json ... \`\`\` block:
{
  "ok": true,
  "plot": {<Observable Plot config or null if no visualization needed>},
  "summary": "<2-4 sentence summary>"
}

`

export async function verifyAndGenerate(options) {
    const {
        user_prompt: userPrompt,
        columns,
        rows,
        sql,
        log_id: logId,
        user = '',
        conversation_id: conversationId = '',
        prior_plot_config: priorPlotConfig,
        no_plot: noPlot = false,
    } = options

    if (!rows || rows.length === 0) {
        return { ok: false, reason: 'Query returned no rows', debug: {} }
    }

    const plotData = getPlotPrompt()
    const plotHeader = plotData.header
    const sourceRowsIdx = plotHeader.indexOf('## source rows')
    const plotRules = sourceRowsIdx > 0 ? plotHeader.slice(sourceRowsIdx) : plotHeader
    const system = _VERIFY_AND_GENERATE_PREFIX + plotRules + '\n' + plotData.examples

    const sample = rows.slice(0, 50)
    const header = columns.join(', ')
    const dataLines = [header, ...sample.map(row => columns.map(c => row[c] === null || row[c] === undefined ? '' : String(row[c])).join(', '))]
    let userMsg = `User question: ${userPrompt}\n\nQuery result:\n${dataLines.join('\n')}`

    for (const kpiCol of ['kpi_dimension', 'kpi_type', 'kpi_service']) {
        if (columns.includes(kpiCol)) {
            const vals = [...new Set(rows.filter(r => r[kpiCol]).map(r => String(r[kpiCol])))]
            if (vals.length > 0) userMsg += `\n${kpiCol} values: ${vals.join(', ')}`
        }
    }
    if (priorPlotConfig) {
        const priorJson = JSON.stringify(priorPlotConfig, null, 2)
        userMsg += '\n\nPrevious plot config (extend this — keep the same mark type and structure, just add/adjust fields for the new data):\n```json\n' + priorJson + '\n```'
    }
    if (sql) userMsg += `\n\nSQL used to produce this data:\n\`\`\`sql\n${sql}\n\`\`\``
    if (noPlot) {
        userMsg += '\n\nNote: The user requested no visualization — return "plot": null.'
    }

    const messages = [{ role: 'user', content: userMsg }]
    const debug = { prompt: system, messages, response: '' }
    try {
        const text = await completeText({
            system,
            messages,
            model: 'sonnet',
            label: 'verify-and-generate',
            log_id: logId,
            user,
            conversation_id: conversationId,
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
                    plot_config: obj.plot || null,
                    summary: obj.summary || null,
                    key_takeaways: obj.key_takeaways || [],
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
            return { ok: true, plot_config: obj.plot || null, summary: obj.summary || null, key_takeaways: obj.key_takeaways || [], debug }
        } catch (_) {}
        return { ok: true, plot_config: null, summary: text.slice(0, 500) || null, key_takeaways: [], debug }
    } catch (e) {
        console.log('[generate2] verifyAndGenerate error:', e.message)
        return { ok: true, plot_config: null, summary: null, key_takeaways: [], debug }
    }
}

export async function* run(options) {
    const {
        prompt,
        matches = [],
        templates = {},
        history,
        msg_id: msgId,
        user,
        conversation_id: conversationId,
        prior_sql: priorSql,
        prior_plot_config: priorPlotConfig,
        label = 'Generation',
        template_fallback_feedback: templateFallbackFeedback,
    } = options

    const systemPrompt = await buildSystemPrompt({ matches, templates, priorSql, templateFallbackFeedback })
    const messages = buildMessages(history, prompt)
    console.log(`[generate2] running with ${matches.length} template hints`)

    for (let attempt = 0; attempt < 4; attempt++) {
        let fullText = ''
        const roundLabel = attempt === 0 ? label : `Retry ${attempt}`

        for await (const chunk of complete({
            system: systemPrompt,
            messages,
            model: 'sonnet',
            label: roundLabel,
            log_id: msgId,
            user,
            conversation_id: conversationId,
        })) {
            if (chunk.type === 'token') {
                fullText += chunk.text
                process.stdout.write(chunk.text)
            }
            yield chunk
        }
        process.stdout.write('\n')

        const sqlMatch = fullText.match(/```sql\s*([\s\S]*?)\s*```/)
        if (!sqlMatch) {
            const suggestions = []
            const suggMatch = fullText.match(/<!--suggestions\s*(.*?)\s*-->/s)
            if (suggMatch) {
                const items = suggMatch[1].split('\n').map(l => l.trim()).filter(Boolean)
                suggestions.push(...items)
            }
            const displayText = fullText.replace(/\s*<!--suggestions.*?-->/gs, '').trim()
            if (displayText) yield { type: 'text', text: displayText }
            if (suggestions.length > 0) yield { type: 'suggestions', items: suggestions }
            return
        }

        const sql = postprocessSql(sqlMatch[1].trim())
        console.log('[generate2] extracted sql →', sql.slice(0, 200))

        let columns, rows
        try {
            const result = await executeQuery(sql)
            columns = result.columns
            rows = result.rows
            yield { type: 'sql', sql, plot_config: null, explanation: '' }
            yield { type: 'rows', columns, rows }
            const cardinalityCheck = validateColumnCardinality(columns, rows)
            if (!cardinalityCheck.ok) {
                console.log('[generate2] cardinality check failed:', cardinalityCheck.reason)
                yield { type: 'error', error: cardinalityCheck.reason }
                messages.push(
                    { role: 'assistant', content: fullText },
                    { role: 'user', content: `## Revision Feedback\n${cardinalityCheck.reason}\n\nRewrite the SQL to fix this.` }
                )
                continue
            }
        } catch (e) {
            console.log('[generate2] query error:', e.message)
            yield { type: 'error', error: `SQL error: ${e.message}` }
            messages.push(
                { role: 'assistant', content: fullText },
                { role: 'user', content: `## Revision Feedback\nSQL error: ${e.message}\n\nFix the SQL and try again.` }
            )
            continue
        }

        const wantPlot = needsPlot(prompt, columns, rows)
        const vgResult = await verifyAndGenerate({
            user_prompt: prompt,
            columns,
            rows,
            sql,
            log_id: msgId,
            user,
            conversation_id: conversationId,
            prior_plot_config: wantPlot ? priorPlotConfig : null,
            no_plot: !wantPlot,
        })

        const vgDebug = vgResult.debug || {}
        yield { type: 'round', label: 'Plot & Summary' }
        if (vgDebug.prompt) yield { type: 'prompt', text: vgDebug.prompt }
        if (vgDebug.messages) yield { type: 'messages', messages: vgDebug.messages }
        if (vgDebug.response) yield { type: 'response', text: vgDebug.response }

        if (vgResult.ok) {
            const plotConfig = vgResult.plot_config
            const summary = vgResult.summary
            const kt = vgResult.key_takeaways || []
            if (plotConfig && wantPlot) {
                yield { type: 'plot_config', plot_config: plotConfig }
            } else {
                yield { type: 'no_plot' }
            }
            if (kt.length > 0) yield { type: 'key_takeaways', items: kt }
            if (summary) yield { type: 'summary', text: summary }
            updateResultData(msgId, { columns, rows, plot_config: plotConfig, summary })
            return
        }

        const reason = vgResult.reason || "Data doesn't answer the question"
        console.log(`[generate2] attempt ${attempt + 1} verify failed: ${reason}`)
        messages.push(
            { role: 'assistant', content: fullText },
            { role: 'user', content: `## Revision Feedback\nThe data does not answer the question: ${reason}\n\nWrite a new SQL query.` }
        )
    }

    yield { type: 'round', label: 'Retry limit reached' }
}

export default { buildSystemPrompt, verifyAndGenerate, needsPlot, run }
