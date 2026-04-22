// SQL post-processing utilities — port of backend/sql_utils.py

function _removeEmptyStringFilters(sql) {
    const cols = ['age_group', 'population_segment', 'kpi_dimension']
    let result = sql
    for (const col of cols) {
        const empty = `(?:'{2}|"{2})`
        const cond = `${col}\\s*=\\s*${empty}`
        result = result.replace(new RegExp(`\n[ \t]*AND[ \t]+${cond}[ \t]*`, 'gi'), '')
        result = result.replace(new RegExp(`[ \t]*${cond}[ \t]+AND[ \t]*\n?`, 'gi'), '')
        result = result.replace(new RegExp(`[ \t]*${cond}[ \t]*`, 'gi'), '')
    }
    result = result.replace(/\bWHERE\s*(?=GROUP\b|ORDER\b|LIMIT\b)/gi, '')
    result = result.replace(/\n[ \t]*\n/g, '\n')
    return result.trim()
}

function _fixIncompleteIsNullOr(sql) {
    let result = sql.replace(
        /\(\s*(\w+)\s+IS\s+NULL\s+OR\s*\)/gi,
        "($1 IS NULL OR $1 = '')"
    )
    result = result.replace(
        /\(\s*(\w+)\.(\w+)\s+IS\s+NULL\s+OR\s+\1\.\s*\)/gi,
        "($1.$2 IS NULL OR $1.$2 = '')"
    )
    return result
}

const _POST_PROCESSORS = [
    ['remove_empty_string_filters', _removeEmptyStringFilters],
    ['fix_incomplete_is_null_or', _fixIncompleteIsNullOr],
]

export function postprocessSql(sql) {
    let result = sql
    for (const [name, fn] of _POST_PROCESSORS) {
        const before = result
        result = fn(result)
        if (result !== before) {
            console.log(`[postprocess] ${name} changed sql`)
        }
    }
    return result
}

export function buildMessages(history, prompt) {
    const messages = []
    for (const h of history) {
        messages.push({ role: h.role, content: h.text })
    }
    messages.push({ role: 'user', content: prompt })
    return messages
}

export function extractSql(text) {
    const m1 = text.match(/```sql\s*(.*?)\s*```/s)
    if (m1) return m1[1].trim()
    const m2 = text.match(/(SELECT\s+.+?;)/si)
    if (m2) return m2[1].trim()
    return null
}
