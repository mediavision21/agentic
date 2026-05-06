// import { executeQuery, getKpiTypeDimensions } from './db.js'

// let _dataExamplesCache = null
// let _kpiCombinationsCache = null
// let _dimToKpiCache = null

// const _KPI_TYPE_PRIORITY = ['reach', 'penetration', 'viewing_time', 'spend', 'churn_intention', 'stacking', 'account_sharing', 'gross_access']

// const DATA_EXAMPLES_SQL = `
// WITH latest AS (
//     SELECT year, quarter
//     FROM macro.nordic
//     ORDER BY year DESC, quarter DESC
//     LIMIT 1
// ),
// ranked AS (
//     SELECT
//         n.year,
//         n.quarter_label,
//         n.country,
//         n.category,
//         COALESCE(n.canonical_name, '') AS service,
//         n.kpi_type,
//         COALESCE(n.kpi_dimension, '') AS kpi_dimension,
//         COALESCE(n.kpi_detail, '') AS kpi_detail,
//         n.age_group,
//         COALESCE(n.population_segment, '') AS population_segment,
//         ROUND(n.value::numeric, 4) AS value,
//         ROW_NUMBER() OVER (
//             PARTITION BY n.kpi_type, n.country
//             ORDER BY n.category, n.canonical_name, n.kpi_dimension
//         ) AS rn
//     FROM macro.nordic n
//     JOIN latest l ON n.year = l.year AND n.quarter = l.quarter
//     WHERE n.country IN ('sweden', 'norway')
//       AND n.kpi_type IN ('reach', 'viewing_time', 'penetration', 'spend', 'reach_service')
// )
// SELECT year, quarter_label, country, category, service,
//        kpi_type, kpi_dimension, kpi_detail, age_group, population_segment, value
// FROM ranked
// WHERE rn <= 5
// ORDER BY kpi_type, country, rn
// `

// const KPI_COMBINATIONS_SQL = `
// SELECT DISTINCT category, kpi_type, COALESCE(kpi_dimension, '') AS kpi_dimension
// FROM macro.nordic
// WHERE category IS NOT NULL AND kpi_type IS NOT NULL
// ORDER BY category, kpi_type, kpi_dimension
// `

// const CANONICAL_NAMES_SQL = `
// SELECT DISTINCT canonical_name
// FROM macro.nordic
// WHERE canonical_name IS NOT NULL AND canonical_name != ''
// ORDER BY canonical_name
// `

// export async function loadDataExamples() {
//     if (_dataExamplesCache !== null) return _dataExamplesCache
//     try {
//         const data = await executeQuery(DATA_EXAMPLES_SQL)
//         const cols = data.columns
//         const lines = [cols.join(',')]
//         for (const row of data.rows) {
//             lines.push(cols.map(c => (row[c] === null || row[c] === undefined) ? '' : String(row[c])).join(','))
//         }
//         _dataExamplesCache = lines.join('\n')
//     } catch (e) {
//         console.log('[data_examples] loadDataExamples error:', e.message)
//         _dataExamplesCache = ''
//     }
//     return _dataExamplesCache
// }

// export async function loadDimensionToKpi() {
//     if (_dimToKpiCache !== null) return _dimToKpiCache
//     try {
//         const kpiDims = await getKpiTypeDimensions('nordic')  // {kpi_type: [dims]}
//         const inverted = {}
//         for (const [kpiType, dims] of Object.entries(kpiDims)) {
//             for (const dim of dims) {
//                 if (dim && !inverted[dim]) {
//                     inverted[dim] = kpiType
//                 } else if (dim) {
//                     const existingPri = _KPI_TYPE_PRIORITY.includes(inverted[dim]) ? _KPI_TYPE_PRIORITY.indexOf(inverted[dim]) : 999
//                     const newPri = _KPI_TYPE_PRIORITY.includes(kpiType) ? _KPI_TYPE_PRIORITY.indexOf(kpiType) : 999
//                     if (newPri < existingPri) {
//                         inverted[dim] = kpiType
//                     }
//                 }
//             }
//         }
//         _dimToKpiCache = inverted
//         console.log('[data_examples] loaded dimension_to_kpi:', inverted)
//     } catch (e) {
//         console.log('[data_examples] loadDimensionToKpi error:', e.message)
//         _dimToKpiCache = {}
//     }
//     return _dimToKpiCache
// }

// export async function loadKpiCombinations() {
//     if (_kpiCombinationsCache !== null) return _kpiCombinationsCache
//     try {
//         const combos = await executeQuery(KPI_COMBINATIONS_SQL)
//         const names = await executeQuery(CANONICAL_NAMES_SQL)
//         const rows = ['category,kpi_type,kpi_dimension']
//         for (const row of combos.rows) {
//             rows.push(`${row.category || ''},${row.kpi_type || ''},${row.kpi_dimension || ''}`)
//         }
//         const canonical = names.rows.map(r => r.canonical_name)
//         rows.push('')
//         rows.push('Valid canonical_names (for service KPIs): ' + canonical.join(', '))
//         _kpiCombinationsCache = rows.join('\n')
//     } catch (e) {
//         console.log('[data_examples] loadKpiCombinations error:', e.message)
//         _kpiCombinationsCache = ''
//     }
//     return _kpiCombinationsCache
// }
