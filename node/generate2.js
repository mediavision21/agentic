import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { complete, completeText } from './llm.js'
import { executeQuery } from './db.js'
import { updateResultData } from './sqlite.js'
import { postprocessSql, buildMessages } from './sql_utils.js'
import { getSummaryPrompt } from './prompts.js'

const ONTOLOGY_PATH = join(import.meta.dirname, '..', 'skills', 'ONTOLOGY.md')
let _ontology = null
let _serviceIdToCanonical = undefined

async function getServiceIdToCanonical() {
    if (_serviceIdToCanonical === undefined) {
        const result = await executeQuery(`SELECT service_id, canonical_name FROM macro.dim_service WHERE canonical_name IS NOT NULL`)
        _serviceIdToCanonical = Object.fromEntries(result.rows.map(r => [r.service_id, r.canonical_name]))
        console.log('[generate2] loaded service_id→canonical_name map:', Object.keys(_serviceIdToCanonical).length, 'entries')
    }
    return _serviceIdToCanonical
}

function getOntology() {
    if (!_ontology) {
        _ontology = readFileSync(ONTOLOGY_PATH, 'utf8')
    }
    return _ontology
}

const _SYSTEM_HEADER = `You are a SQL expert for Mediavision's media research database.
Generate a single SQL query that answers the user's question.
Return the SQL in a \`\`\`sql ... \`\`\` block.

**Never ask clarifying questions.** When kpi_type or other parameters are ambiguous, apply the defaults defined in the ontology and generate SQL immediately. The summary layer will offer follow-up suggestions to the user.

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
        base += `while preserving the prior query's structure (e.g., add a period, filter, or column). `
        base += 'Keep the same kpi_type, services, countries, and grouping unless the user explicitly asks to change them.'
        base += '\n\nPrior SQL:\n```sql\n${priorSql}\n```'
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
        sql_gen_messages: sqlGenMessages = null,
        force = false,
    } = options

    if (!rows || rows.length === 0) {
        return { ok: false, reason: 'Query returned no rows', debug: {} }
    }

    let system = getSummaryPrompt()
    if (force) {
        system += '\n\nIMPORTANT: You MUST return ok:true. Do not return ok:false. Provide your best-effort answer even if the data is imperfect. Note any limitations in the summary.'
    }

    const sample = rows.slice(0, 50)
    const header = columns.join(', ')
    const dataLines = [header, ...sample.map(row => columns.map(c => row[c] === null || row[c] === undefined ? '' : String(row[c])).join(', '))]

    let dataMsg = `Query result:\n${dataLines.join('\n')}`

    if (columns.includes('population_segment')) {
        const segMap = { viewers: 'actual viewers (not per-capita)', subscribers: 'subscribers only', users: 'active users', genre_viewers: 'genre-specific viewers' }
        const segs = [...new Set(rows.filter(r => r['population_segment']).map(r => String(r['population_segment'])))]
        if (segs.length > 0) dataMsg += `\npopulation_segment: ${segs.map(s => `${s} (${segMap[s] || s})`).join(', ')} — mention this in your summary`
    }
    if (priorPlotConfig) {
        const priorJson = JSON.stringify(priorPlotConfig, null, 2)
        dataMsg += '\n\nPrevious plot config (extend this — keep the same mark type and structure, just add/adjust fields for the new data):\n```json\n' + priorJson + '\n```'
    }
    if (noPlot) dataMsg += '\n\nNote: The user requested no visualization — return "plot": null.'

    let messages
    if (sqlGenMessages) {
        // Reuse SQL generation conversation history — LLM already knows the question and SQL
        messages = [...sqlGenMessages, { role: 'user', content: dataMsg }]
    } else {
        // Standalone call — include full context
        let userMsg = `User question: ${userPrompt}\n\n${dataMsg}`
        if (sql) userMsg += `\n\nSQL used:\n\`\`\`sql\n${sql}\n\`\`\``
        messages = [{ role: 'user', content: userMsg }]
    }

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
                    suggestions: obj.suggestions || [],
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
            return { ok: true, plot_config: obj.plot || null, summary: obj.summary || null, key_takeaways: obj.key_takeaways || [], suggestions: obj.suggestions || [], debug }
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

    let lastSql = null, lastColumns = null, lastRows = null, lastFailReason = null

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
            // filter out columns with only one distinct value — they carry no visual information
            const filteredColumns = columns/*.filter(col => {
                const unique = new Set(rows.map(r => r[col]))
                return unique.size > 1
            })*/
            
            yield { type: 'sql', sql, plot_config: null, explanation: '' }
            yield { type: 'rows', columns, rows }

            if (rows.length === 0) {
                lastFailReason = 'Query returned no rows'
                console.log('[generate2] query returned 0 rows')
                yield { type: 'error', error: 'Query returned no rows' }
                messages.push(
                    { role: 'assistant', content: fullText },
                    { role: 'user', content: `## Revision Feedback\nThe query returned 0 rows. The data may not exist for these filter criteria. Try different filters, a different time period, or a different metric.\n\nWrite a new SQL query.` }
                )
                continue
            }

            const cardinalityCheck = validateColumnCardinality(columns, rows)

			columns = filteredColumns
            rows = rows.map(r => Object.fromEntries(filteredColumns.map(col => [col, r[col]])))

            if (!cardinalityCheck.ok) lastFailReason = cardinalityCheck.reason
            if (cardinalityCheck.ok) {
                if (columns.includes('service_id')) {
                    const map = await getServiceIdToCanonical()
                    columns = [...columns, 'canonical_name']
                    rows = rows.map(r => ({ ...r, canonical_name: map[r.service_id] || null }))
                }
            }
            else {
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
            lastFailReason = e.message
            yield { type: 'error', error: `SQL error: ${e.message}` }
            messages.push(
                { role: 'assistant', content: fullText },
                { role: 'user', content: `## Revision Feedback\nSQL error: ${e.message}\n\nFix the SQL and try again.` }
            )
            continue
        }

        const wantPlot = needsPlot(prompt, columns, rows)
        const sqlHistory = [...messages, { role: 'assistant', content: fullText }]
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
            sql_gen_messages: sqlHistory,
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
            const suggestions = vgResult.suggestions || []
            if (plotConfig && wantPlot) {
                yield { type: 'plot_config', plot_config: plotConfig }
            } else {
                yield { type: 'no_plot' }
            }
            if (kt.length > 0) yield { type: 'key_takeaways', items: kt }
            if (summary) yield { type: 'summary', text: summary }
            if (suggestions.length > 0) yield { type: 'suggestions', items: suggestions }
            updateResultData(msgId, { columns, rows, plot_config: plotConfig, summary })
            return
        }

        const reason = vgResult.reason || "Data doesn't answer the question"
        console.log(`[generate2] attempt ${attempt + 1} verify failed: ${reason}`)
        lastSql = sql; lastColumns = columns; lastRows = rows; lastFailReason = reason
        messages.push(
            { role: 'assistant', content: fullText },
            { role: 'user', content: `## Revision Feedback\nThe data does not answer the question: ${reason}\n\nWrite a new SQL query.` }
        )
    }

    yield { type: 'round', label: 'Best Effort' }
    if (lastColumns && lastRows) {
        const wantPlot = needsPlot(prompt, lastColumns, lastRows)
        const forced = await verifyAndGenerate({
            user_prompt: prompt,
            columns: lastColumns,
            rows: lastRows,
            sql: lastSql,
            log_id: msgId,
            user,
            conversation_id: conversationId,
            prior_plot_config: wantPlot ? priorPlotConfig : null,
            no_plot: !wantPlot,
            force: true,
        })
        const forcedDebug = forced.debug || {}
        if (forcedDebug.prompt) yield { type: 'prompt', text: forcedDebug.prompt }
        if (forcedDebug.messages) yield { type: 'messages', messages: forcedDebug.messages }
        if (forcedDebug.response) yield { type: 'response', text: forcedDebug.response }
        if (forced.plot_config && wantPlot) yield { type: 'plot_config', plot_config: forced.plot_config }
        else yield { type: 'no_plot' }
        if ((forced.key_takeaways || []).length > 0) yield { type: 'key_takeaways', items: forced.key_takeaways }
        if (forced.summary) yield { type: 'summary', text: forced.summary }
        if ((forced.suggestions || []).length > 0) yield { type: 'suggestions', items: forced.suggestions }
        updateResultData(msgId, { columns: lastColumns, rows: lastRows, plot_config: forced.plot_config, summary: forced.summary })
    } else {
        const text = lastFailReason
            ? `I was unable to find data that answers your question. ${lastFailReason}`
            : `I was unable to find data that answers your question after several attempts.`
        yield { type: 'summary', text }
    }
}

export default { buildSystemPrompt, verifyAndGenerate, needsPlot, run }
