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
			out += `<span class="sql-comment">${esc(sql.slice(i, j))}</span>`
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
			out += `<span class="sql-str">${esc(sql.slice(i, j))}</span>`
			i = j
			continue
		}
		// number (only when preceded by non-word char)
		if (/[0-9]/.test(sql[i]) && (i === 0 || /[^a-zA-Z0-9_]/.test(sql[i - 1]))) {
			let j = i
			while (j < sql.length && /[0-9.]/.test(sql[j])) j++
			out += `<span class="sql-num">${esc(sql.slice(i, j))}</span>`
			i = j
			continue
		}
		// word — keyword or identifier
		if (/[a-zA-Z_]/.test(sql[i])) {
			let j = i
			while (j < sql.length && /[a-zA-Z0-9_]/.test(sql[j])) j++
			const word = sql.slice(i, j)
			if (SQL_KEYWORDS.has(word.toUpperCase())) {
				out += `<span class="sql-kw">${esc(word)}</span>`
			} else {
				out += `<span class="sql-id">${esc(word)}</span>`
			}
			i = j
			continue
		}
		out += esc(sql[i])
		i++
	}

	return out
}

// Tokenize markdown line-by-line. Inside code fences, applies language-specific highlight.
export function highlightMarkdown(text) {
	const lines = text.split('\n')
	let inCode = false
	let fenceLang = null // "sql", "js", "json", or null

	return lines.map(function (line) {
		// code fence boundary — check raw line before escaping
		if (/^```/.test(line)) {
			const entering = !inCode
			inCode = !inCode
			if (entering) {
				if (/^```sql/i.test(line)) fenceLang = "sql"
				else if (/^```js|^```javascript/i.test(line)) fenceLang = "js"
				else if (/^```json/i.test(line)) fenceLang = "json"
				else fenceLang = null
			}
			return `<span class="hl-fence">${esc(line)}</span>`
		}

		if (inCode) {
			if (fenceLang === "sql") return highlightSQL(line)
			if (fenceLang === "js") return highlightJS(line)
			if (fenceLang === "json") return highlightJSON(line)
			return `<span class="hl-code">${esc(line)}</span>`
		}

		const e = esc(line)

		if (/^### /.test(e)) return `<span class="hl-h3">${e}</span>`
		if (/^## /.test(e)) return `<span class="hl-h2">${e}</span>`
		if (/^# /.test(e)) return `<span class="hl-h1">${e}</span>`
		if (/^[-*] /.test(e)) return `<span class="hl-list">${e}</span>`

		// inline **bold**
		return e.replace(/\*\*(.+?)\*\*/g, '<span class="hl-bold">**$1**</span>')
	}).join('\n')
}

const JS_KEYWORDS = new Set([
	'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
	'default', 'delete', 'do', 'else', 'export', 'extends', 'finally', 'for',
	'from', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new',
	'of', 'return', 'switch', 'throw', 'try', 'typeof', 'var', 'void',
	'while', 'yield', 'true', 'false', 'null', 'undefined', 'this',
])

export function highlightJS(code) {
	let out = ''
	let i = 0
	while (i < code.length) {
		// single-line comment
		if (code[i] === '/' && code[i + 1] === '/') {
			let j = code.indexOf('\n', i)
			if (j === -1) j = code.length
			out += `<span class="js-comment">${esc(code.slice(i, j))}</span>`
			i = j
			continue
		}
		// multi-line comment
		if (code[i] === '/' && code[i + 1] === '*') {
			let j = code.indexOf('*/', i + 2)
			j = j === -1 ? code.length : j + 2
			out += `<span class="js-comment">${esc(code.slice(i, j))}</span>`
			i = j
			continue
		}
		// string (single or double quote or backtick)
		if (code[i] === '"' || code[i] === "'" || code[i] === '`') {
			const q = code[i]
			let j = i + 1
			while (j < code.length) {
				if (code[j] === '\\') { j += 2; continue }
				if (code[j] === q) { j++; break }
				j++
			}
			out += `<span class="js-str">${esc(code.slice(i, j))}</span>`
			i = j
			continue
		}
		// number
		if (/[0-9]/.test(code[i]) && (i === 0 || /[^a-zA-Z0-9_$]/.test(code[i - 1]))) {
			let j = i
			while (j < code.length && /[0-9.eExXa-fA-F_]/.test(code[j])) j++
			out += `<span class="js-num">${esc(code.slice(i, j))}</span>`
			i = j
			continue
		}
		// word
		if (/[a-zA-Z_$]/.test(code[i])) {
			let j = i
			while (j < code.length && /[a-zA-Z0-9_$]/.test(code[j])) j++
			const word = code.slice(i, j)
			if (JS_KEYWORDS.has(word)) {
				out += `<span class="js-kw">${esc(word)}</span>`
			} else {
				out += esc(word)
			}
			i = j
			continue
		}
		out += esc(code[i])
		i++
	}
	return out
}

export function highlightJSON(obj) {
	const s = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)
	let out = ''
	let i = 0
	while (i < s.length) {
		if (s[i] === '"') {
			let j = i + 1
			while (j < s.length) {
				if (s[j] === '\\') { j += 2; continue }
				if (s[j] === '"') { j++; break }
				j++
			}
			const str = s.slice(i, j)
			let k = j
			while (k < s.length && /\s/.test(s[k])) k++
			if (s[k] === ':') {
				out += `<span class="json-key">${esc(str)}</span>`
			} else {
				out += `<span class="json-str">${esc(str)}</span>`
			}
			i = j
			continue
		}
		if (/[0-9\-]/.test(s[i]) && (i === 0 || /[^a-zA-Z0-9_]/.test(s[i - 1]))) {
			let j = i
			if (s[j] === '-') j++
			while (j < s.length && /[0-9.eE+\-]/.test(s[j])) j++
			out += `<span class="json-num">${esc(s.slice(i, j))}</span>`
			i = j
			continue
		}
		let matched = false
		for (const kw of ['true', 'false', 'null']) {
			if (s.startsWith(kw, i) && (i + kw.length >= s.length || /[^a-zA-Z]/.test(s[i + kw.length]))) {
				out += `<span class="json-kw">${kw}</span>`
				i += kw.length
				matched = true
				break
			}
		}
		if (!matched) {
			out += esc(s[i])
			i++
		}
	}
	return out
}
