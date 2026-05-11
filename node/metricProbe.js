import Anthropic from '@anthropic-ai/sdk'
import { executeQuery } from './db.js'

const client = new Anthropic({ apiKey: process.env.API_KEY })
const HAIKU = 'claude-haiku-4-5-20251001'

const ALTERNATIVES_SYSTEM = `You are a media data analyst. Given a user question, return a JSON array of exactly 3 filter combinations for querying the Mediavision nordic table.

Each element must include:

"answer_type": classify the question into exactly one of:
   ranking, trend, comparison, distribution, correlation, text, market_overview, clarification_needed, data_not_available

   Rules:
   - ranking: top N, highest, lowest, point-in-time ranking
   - trend: over time, developed, grown, changed, since
   - comparison: comparing two or more markets/services/time periods
   - distribution: share, composition, split, breakdown, how much of
   - correlation: relationship between two metrics, does X affect Y
   - text: why, what does this mean, how do you interpret (analytical not data retrieval)
   - market_overview: overview, summarise, give me a picture of
   - data_not_available: clearly no data exists for this
   - clarification_needed: question is ambiguous, missing market/period/metric

"answer_confidence": float 0.0–1.0, how likely the fetched probe rows alone can fully answer the question without further SQL transformation.
   - 1.0: the question is a direct data lookup (e.g. "what is Netflix reach in Sweden?") and the rows suffice
   - 0.7–0.9: ranking/trend/comparison that can be read off the rows with minor aggregation
   - 0.3–0.6: market_overview or multi-step analysis — rows help but a custom SQL is better
   - 0.0–0.2: text/correlation/why questions, or data_not_available / clarification_needed

Valid kpi_type values: reach, reach_monthly, reach_weekly, penetration, gross_access, viewing_time, spend, stacking, churn_intention, account_sharing

Valid kpi_type + kpi_dimension combinations (kpi_dimension is only for market-level, service_id must be null):
- account_sharing: ssvod, svod
- churn_intention: svod
- gross_access: svod
- penetration: bsvod, fta, hvod, illegal_iptv, ott, pay_tv_channel, ssvod, svod, tve
- reach: ads_ott, avod, bsvod, fast, hvod, online_excluding_social, online_total, public_service, social, ssvod, svod
- reach_weekly: online_total
- spend: ssvod
- stacking: hvod, ssvod, svod
- viewing_time: avod, bsvod, hvod, online_excluding_social, social, ssvod

service_id examples: netflix, viaplay, disney, hbo_max, apple_tv, youtube, tiktok, instagram, svt_play, nrk, dr
When service_id is set, kpi_dimension can be null or specify value.

Return ONLY this JSON array, no explanation, no markdown wrapper:
[{"answer_type":"ranking","answer_confidence":0.9,"kpi_type":"...","kpi_dimension":"...or null","service_id":"...or null"},...]
`

function sanitizeId(val) {
    // only allow alphanumeric + underscore to prevent injection
    return val && /^[\w]+$/.test(val) ? val : null
}

async function generateAlternatives(prompt) {
    const msg = await client.messages.create({
        model: HAIKU,
        max_tokens: 600,
        temperature: 0,
        system: ALTERNATIVES_SYSTEM,
        messages: [{ role: 'user', content: prompt }],
    })
    const llm_prompt = `[system]\n${ALTERNATIVES_SYSTEM}\n[user]\n${prompt}`
    const llm_response = msg.content[0]?.text || '[]'
    try {
        const match = llm_response.match(/\[[\s\S]*\]/)
        const alts = match ? JSON.parse(match[0]) : []
        const answer_type = Array.isArray(alts) && alts.length > 0 ? (alts[0].answer_type || 'text') : 'text'
        return {
            answer_type,
            alternatives: Array.isArray(alts) ? alts : [],
            llm_prompt,
            llm_response,
        }
    } catch (_) {
        return { answer_type: 'text', alternatives: [], llm_prompt, llm_response }
    }
}

export const MAX_ROWS=500
async function runComboQuery(combo) {
    const kpi_type = sanitizeId(combo.kpi_type)
    const kpi_dimension = sanitizeId(combo.kpi_dimension)
    const service_id = sanitizeId(combo.service_id)

    if (!kpi_type) return { rows: [], error: 'invalid kpi_type' }

    let sql
    if (service_id) {
        sql = `SELECT period_date, country, kpi_type, kpi_dimension, service_id, age_group, value
FROM macro.nordic
WHERE kpi_type = '${kpi_type}' AND service_id = '${service_id}' AND age_group = '15-74' and period_date >= '2025-01-01'
ORDER BY period_date DESC LIMIT ${MAX_ROWS}`
    } else if (kpi_dimension) {
        sql = `SELECT period_date, country, kpi_type, kpi_dimension, service_id, age_group, value
FROM macro.nordic
WHERE kpi_type = '${kpi_type}' AND kpi_dimension = '${kpi_dimension}' AND service_id IS NULL AND age_group = '15-74' and period_date >= '2025-01-01'
ORDER BY period_date DESC LIMIT ${MAX_ROWS}`
    } else {
        sql = `SELECT period_date, country, kpi_type, kpi_dimension, service_id, age_group, value
FROM macro.nordic
WHERE kpi_type = '${kpi_type}' AND service_id IS NULL AND kpi_dimension IS NULL AND age_group = '15-74' and period_date >= '2025-01-01'
ORDER BY period_date DESC LIMIT ${MAX_ROWS}`
    }

    try {
        const result = await executeQuery(sql)
        return { sql, rows: result.rows, error: null }
    } catch (e) {
        return { sql, rows: [], error: e.message }
    }
}

// Returns {answer_type, candidates} where candidates only includes combos with data.
// Each candidate: {kpi_type, kpi_dimension, service_id, row_count, rows, sample_rows}
// Caller owns db lifecycle (initPool/closePool).
export async function metricProbe(prompt) {
    const { answer_type, alternatives, llm_prompt, llm_response } = await generateAlternatives(prompt)
    if (alternatives.length === 0) {
        return { answer_type, answer_confidence: 0, candidates: [], llm_prompt, llm_response }
    }

    const results = await Promise.all(alternatives.map(combo => runComboQuery(combo)))

    const candidates = alternatives
        .map((combo, i) => ({
            kpi_type: combo.kpi_type,
            kpi_dimension: combo.kpi_dimension ?? null,
            service_id: combo.service_id ?? null,
            answer_type: combo.answer_type || answer_type,
            answer_confidence: typeof combo.answer_confidence === 'number' ? combo.answer_confidence : 0,
            sql: results[i].sql,
            row_count: results[i].rows.length,
            rows: results[i].rows,
            sample_rows: results[i].rows.slice(0, 3),
        }))
        .filter(c => c.row_count > 0)

    const answer_confidence = candidates.length > 0
        ? Math.max(...candidates.map(c => c.answer_confidence))
        : 0

    return { answer_type, answer_confidence, candidates, llm_prompt, llm_response }
}
