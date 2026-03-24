// shared syntax highlighters — no external deps

const SQL_KEYWORDS = new Set([
	'SELECT', 'FROM', 'WHERE', 'GROUP', 'BY', 'ORDER', 'HAVING',
	'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS',
	'ON', 'AS', 'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'LIKE',
	'BETWEEN', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'WITH',
	'LIMIT', 'OFFSET', 'DISTINCT', 'ALL', 'UNION', 'INTERSECT',
	'EXCEPT', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET',
	'DELETE', 'CREATE', 'DROP', 'TABLE', 'VIEW', 'ALTER',
	'AVG', 'SUM', 'COUNT', 'MIN', 'MAX', 'ROUND', 'CAST',
	'COALESCE', 'NULLIF', 'EXTRACT', 'DATE', 'NOW',
	'OVER', 'PARTITION', 'ROWS', 'RANGE', 'UNBOUNDED',
	'PRECEDING', 'FOLLOWING', 'CURRENT', 'ROW', 'TRUE', 'FALSE',
	'ASC', 'DESC', 'NULLS', 'FIRST', 'LAST', 'READ', 'ONLY',
	'TRANSACTION', 'MACRO', 'NORDIC', 'YEAR', 'QUARTER',
])

function esc(s) {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Tokenize SQL and return HTML string with span-wrapped tokens.
export function highlightSQL(sql) {
	let out = ''
	let i = 0

	while (i < sql.length) {
		// -- single-line comment
		if (sql[i] === '-' && sql[i + 1] === '-') {
			let j = sql.indexOf('\n', i)
			if (j === -1) j = sql.length
			out += `<span className="sql-comment">${esc(sql.slice(i, j))}</span>`
			i = j
			continue
		}
		// string literal
		if (sql[i] === "'") {
			let j = i + 1
			while (j < sql.length) {
				if (sql[j] === "'" && sql[j - 1] !== '\\') { j++; break }
				j++
			}
			out += `<span className="sql-str">${esc(sql.slice(i, j))}</span>`
			i = j
			continue
		}
		// number (only when preceded by non-word char)
		if (/[0-9]/.test(sql[i]) && (i === 0 || /[^a-zA-Z0-9_]/.test(sql[i - 1]))) {
			let j = i
			while (j < sql.length && /[0-9.]/.test(sql[j])) j++
			out += `<span className="sql-num">${esc(sql.slice(i, j))}</span>`
			i = j
			continue
		}
		// word — keyword or identifier
		if (/[a-zA-Z_]/.test(sql[i])) {
			let j = i
			while (j < sql.length && /[a-zA-Z0-9_]/.test(sql[j])) j++
			const word = sql.slice(i, j)
			if (SQL_KEYWORDS.has(word.toUpperCase())) {
				out += `<span className="sql-kw">${esc(word)}</span>`
			} else {
				out += `<span className="sql-id">${esc(word)}</span>`
			}
			i = j
			continue
		}
		out += esc(sql[i])
		i++
	}

	return out
}

// Tokenize markdown line-by-line. Inside ```sql fences, applies SQL highlight.
export function highlightMarkdown(text) {
	const lines = text.split('\n')
	let inCode = false
	let isSQLFence = false

	return lines.map(function (line) {
		// code fence boundary — check raw line before escaping
		if (/^```/.test(line)) {
			const entering = !inCode
			inCode = !inCode
			isSQLFence = entering && /^```sql/i.test(line)
			return `<span className="hl-fence">${esc(line)}</span>`
		}

		if (inCode) {
			// apply SQL highlighting inside ```sql fences
			if (isSQLFence) return highlightSQL(line)
			return `<span className="hl-code">${esc(line)}</span>`
		}

		const e = esc(line)

		if (/^### /.test(e)) return `<span className="hl-h3">${e}</span>`
		if (/^## /.test(e)) return `<span className="hl-h2">${e}</span>`
		if (/^# /.test(e)) return `<span className="hl-h1">${e}</span>`
		if (/^[-*] /.test(e)) return `<span className="hl-list">${e}</span>`

		// inline **bold**
		return e.replace(/\*\*(.+?)\*\*/g, '<span className="hl-bold">**$1**</span>')
	}).join('\n')
}
