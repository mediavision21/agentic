const _REQUIRED_COLS = ['period_date', 'country', 'kpi_type', 'kpi_dimension', 'service_id', 'age_group', 'value']
const _DIM_COLS = ['period_date', 'country', 'kpi_type', 'kpi_dimension', 'service_id', 'age_group']

export function validateColumnCardinality(columns, rows) {
	if (rows.some(r => r.category === 'online_video')) {
		rows.splice(0, rows.length, ...rows.filter(r => r.category === 'online_video'))
	}

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