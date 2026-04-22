import { querySingleColumn } from './db.js'

// Central registry of all known template filter placeholders.
export const FILTER_REGISTRY = {
    country: {
        label: 'Country',
        multiple: true,
        choices: ['denmark', 'finland', 'sweden', 'norway'],
        default: ['denmark', 'finland', 'sweden', 'norway'],
    },
    quarter_label: {
        label: 'Quarter',
        multiple: true,
        choices: ['Q1', 'Q2', 'Q3', 'Q4'],
        default: ['Q1', 'Q3'],
    },
    period_label: {
        label: 'Quarter',
        multiple: true,
        choices: ['Q1', 'Q2', 'Q3', 'Q4'],
        default: ['Q1', 'Q3'],
    },
    country_label: {
        label: 'Country',
        multiple: true,
        dynamic_sql: 'SELECT DISTINCT country_label FROM macro.nordic ORDER BY country_label',
        default: ['Denmark', 'Finland', 'Sweden', 'Norway'],
    },
    year: {
        label: 'Year',
        multiple: true,
        dynamic_sql: 'SELECT DISTINCT year FROM macro.nordic ORDER BY year DESC LIMIT 6',
        default: [2021, 2022, 2023, 2024, 2025, 2026],
    },
    service: {
        label: 'Service',
        multiple: true,
        dynamic_sql: 'SELECT DISTINCT canonical_name FROM macro.nordic WHERE canonical_name IS NOT NULL ORDER BY canonical_name',
    },
    currency_code: {
        label: 'Currency',
        multiple: false,
        default: ['DKK', 'EUR', 'NOK', 'SEK'],
        dynamic_sql: 'SELECT DISTINCT currency_code FROM macro.fact_fx_rate_quarterly ORDER BY currency_code',
    },
}

function _mergeSpec(name, yamlFilters) {
    const spec = { ...(FILTER_REGISTRY[name] || {}) }
    if (yamlFilters && yamlFilters[name]) {
        Object.assign(spec, yamlFilters[name])
    }
    return spec
}

export async function buildDefaultFilters(names, yamlFilters = null) {
    const result = {}
    for (const name of names) {
        const spec = _mergeSpec(name, yamlFilters)
        if (Object.keys(spec).length === 0) continue
        if ('default' in spec) {
            result[name] = spec.default
        }
    }
    return result
}

export function detectPlaceholders(sql) {
    const matches = [...sql.matchAll(/\[\[.*?\{\{(\w+)\}\}.*?\]\]/gs)]
    return matches.map(m => m[1])
}

export async function loadFilterChoices(names, yamlFilters = null) {
    const result = {}
    for (const name of names) {
        const spec = _mergeSpec(name, yamlFilters)
        if (Object.keys(spec).length === 0) continue
        if ('choices' in spec) {
            result[name] = spec.choices
        } else if ('dynamic_sql' in spec) {
            try {
                result[name] = await querySingleColumn(spec.dynamic_sql)
            } catch (e) {
                console.log(`[template_filters] failed to load choices for ${name}:`, e.message)
                result[name] = []
            }
        }
    }
    return result
}

const NORDIC_COLUMNS = new Set([
    'country', 'period_date', 'category', 'kpi_type', 'kpi_dimension', 'kpi_detail',
    'age_group', 'population_segment', 'canonical_name',
])

const QUARTER_MONTH = { Q1: 1, Q2: 4, Q3: 7, Q4: 10 }

export function applyFilters(sql, resolved) {
    return sql.replace(/\[\[.*?\]\]/gs, (full) => {
        const nm = full.match(/\{\{(\w+)\}\}/)
        if (!nm) return ''
        const name = nm[1]
        const values = resolved[name]
        if (values && values.length > 0) {
            if (name === 'year') {
                const nums = values.map(v => parseInt(v, 10)).join(', ')
                return `AND EXTRACT(YEAR FROM n.period_date) IN (${nums})`
            }
            if (name === 'quarter_label') {
                const months = values.map(v => QUARTER_MONTH[v]).filter(Boolean)
                if (months.length > 0) {
                    return `AND EXTRACT(MONTH FROM n.period_date) IN (${months.join(', ')})`
                }
                return ''
            }
            const quoted = values.map(v => `'${v}'`).join(', ')
            const col = NORDIC_COLUMNS.has(name) ? `n.${name}` : name
            return `AND ${col} IN (${quoted})`
        }
        return ''
    })
}
