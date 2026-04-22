import pg from 'pg'

const { Pool } = pg
const SCHEMA = 'macro'
const SCHEMA_TABLES = ['nordic']

let _pool = null
let _schemaTextCache = null

export async function initPool() {
    const url = process.env.DATABASE_URL
    // pg handles URL connection strings directly
    _pool = new Pool({ connectionString: url })
    // set search_path on each new connection
    _pool.on('connect', client => {
        client.query(`SET search_path TO ${SCHEMA}, public`)
    })
    // test connection
    const client = await _pool.connect()
    console.log('[db] connected to postgresql')
    client.release()
}

export async function closePool() {
    if (_pool) {
        await _pool.end()
        _pool = null
    }
}

async function _getColumns(table) {
    const sql = `
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = '${SCHEMA}'
          AND table_name = $1
        ORDER BY ordinal_position
        LIMIT 50
    `
    let result = await _pool.query(sql, [table])
    if (result.rows.length === 0) {
        // fallback for materialized views
        const sqlMat = `
            SELECT a.attname AS column_name,
                   pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
                   CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable
            FROM pg_catalog.pg_attribute a
            JOIN pg_catalog.pg_class c ON a.attrelid = c.oid
            JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
            WHERE n.nspname = '${SCHEMA}'
              AND c.relname = $1
              AND a.attnum > 0
              AND NOT a.attisdropped
            ORDER BY a.attnum
            LIMIT 50
        `
        result = await _pool.query(sqlMat, [table])
    }
    return result.rows.map(r => ({ name: r.column_name, type: r.data_type, nullable: r.is_nullable }))
}

const NUMERIC_TYPES = ['int', 'float', 'numeric', 'real', 'double', 'decimal', 'date', 'timestamp']

async function _getColumnStats(table, colName, colType, threshold = 20) {
    const quoted = `"${colName}"`
    try {
        const countRes = await _pool.query(`SELECT COUNT(DISTINCT ${quoted}) FROM ${SCHEMA}."${table}"`)
        const count = parseInt(countRes.rows[0].count, 10)
        if (count <= threshold) {
            const res = await _pool.query(`SELECT DISTINCT ${quoted} FROM ${SCHEMA}."${table}" ORDER BY ${quoted}`)
            const vals = res.rows.map(r => String(r[colName])).filter(v => v !== 'null')
            return `values:[${vals.join(',')}]`
        }
        const isNumeric = NUMERIC_TYPES.some(t => colType.toLowerCase().includes(t))
        if (isNumeric) {
            const res = await _pool.query(`SELECT MIN(${quoted}), MAX(${quoted}) FROM ${SCHEMA}."${table}"`)
            return `range:[${res.rows[0].min}-${res.rows[0].max}]`
        }
        return `${count} distinct`
    } catch (e) {
        console.log(`[db] get_column_stats error ${table}.${colName}:`, e.message)
        return '?'
    }
}

export async function getKpiTypeDimensions(table) {
    const sql = `
        SELECT kpi_type, kpi_dimension
        FROM ${SCHEMA}."${table}"
        WHERE kpi_type IS NOT NULL AND kpi_type != ''
        GROUP BY kpi_type, kpi_dimension
        ORDER BY kpi_type, kpi_dimension
    `
    try {
        const result = await _pool.query(sql)
        const map = {}
        for (const r of result.rows) {
            const kt = r.kpi_type
            const kd = r.kpi_dimension || ''
            if (!map[kt]) map[kt] = []
            map[kt].push(kd)
        }
        return map
    } catch (e) {
        console.log(`[db] getKpiTypeDimensions error ${table}:`, e.message)
        return {}
    }
}

export async function fetchSchemaText() {
    if (_schemaTextCache) return _schemaTextCache
    const EXCLUDE_COLS = new Set(['year', 'period_sort', 'period_label', 'quarter_label', 'quarter'])
    const parts = []
    for (const table of SCHEMA_TABLES) {
        const cols = await _getColumns(table)
        const lines = [`### ${SCHEMA}.${table}`, '| column | type | stats |', '|--------|------|-------|']
        for (const c of cols) {
            if (!EXCLUDE_COLS.has(c.name)) {
                const stats = await _getColumnStats(table, c.name, c.type)
                lines.push(`| ${c.name} | ${c.type} | ${stats} |`)
            }
        }
        const colNames = cols.map(c => c.name)
        if (colNames.includes('kpi_type') && colNames.includes('kpi_dimension')) {
            const kpiMap = await getKpiTypeDimensions(table)
            if (Object.keys(kpiMap).length > 0) {
                lines.push('')
                lines.push('**kpi_type → kpi_dimension mappings:**')
                for (const [kt, dims] of Object.entries(kpiMap)) {
                    lines.push(`- \`${kt}\`: ${dims.join(', ')}`)
                }
            }
        }
        parts.push(lines.join('\n'))
    }
    _schemaTextCache = parts.join('\n\n')
    console.log(`[db] schema text cached (${_schemaTextCache.length} chars)`)
    return _schemaTextCache
}

function _isReadOnly(sql) {
    let stripped = sql.replace(/--[^\n]*/g, '').replace(/\/\*.*?\*\//gs, '').trim().toUpperCase()
    if (!stripped.startsWith('SELECT') && !stripped.startsWith('WITH')) return false
    const dangerous = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|COPY|EXECUTE|DO)\b/i
    if (dangerous.test(stripped)) return false
    return true
}

export async function executeQuery(sql) {
    console.log('executing:', sql)
    if (_isReadOnly(sql)) {
        const client = await _pool.connect()
        try {
            await client.query(`SET search_path TO ${SCHEMA}, public`)
            const result = await client.query(sql)
            console.log('num rows:', result.rows.length)
            if (result.rows.length === 0) return { columns: [], rows: [] }
            const columns = result.fields.map(f => f.name)
            const rows = result.rows.map(r => {
                const row = {}
                for (const k of columns) {
                    const v = r[k]
                    if (v === null || v === undefined) {
                        row[k] = null
                    } else if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
                        row[k] = v
                    } else if (v instanceof Date) {
                        row[k] = v.toISOString()
                    } else {
                        row[k] = String(v)
                    }
                }
                return row
            })
            return { columns, rows }
        } finally {
            client.release()
        }
    } else {
        throw new Error('Only SELECT / WITH queries are allowed')
    }
}

export async function querySingleColumn(sql) {
    console.log('executing:', sql)
    if (_isReadOnly(sql)) {
        const client = await _pool.connect()
        try {
            await client.query(`SET search_path TO ${SCHEMA}, public`)
            const result = await client.query(sql)
            if (result.rows.length === 0) return []
            const fields = result.fields
            if (fields.length > 1) {
                console.log(`[db] WARNING: querySingleColumn got ${fields.length} columns, using only first`)
            }
            const key = fields[0].name
            return result.rows.map(r => {
                const v = r[key]
                if (v === null || v === undefined) return null
                if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v
                return String(v)
            })
        } finally {
            client.release()
        }
    } else {
        throw new Error('Only SELECT / WITH queries are allowed')
    }
}
