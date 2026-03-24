import os
import re
import asyncpg
from urllib.parse import urlparse, urlunparse, quote


pool = None
schema = 'macro'

test_sql = f"""
	SELECT 
		period_key,
		quarter,
		COUNT(*) as record_count,
		COUNT(DISTINCT country) as distinct_countries,
		COUNT(DISTINCT service_id) as distinct_services,
		COUNT(DISTINCT category) as distinct_categories,
		COUNT(DISTINCT kpi_type) as distinct_kpi_types,
		MIN(value) as min_value,
		MAX(value) as max_value,
		AVG(value) as avg_value
	FROM nordic_long_v2
	WHERE quarter IS NOT NULL
	GROUP BY period_key, quarter
	ORDER BY period_key;
"""
async def create_pool():
	global pool
	url = os.getenv("DATABASE_URL")
	# percent-encode password for special chars like ! *
	parsed = urlparse(url)
	if parsed.password:
		encoded_password = quote(parsed.password, safe='')
		netloc = f"{parsed.username}:{encoded_password}@{parsed.hostname}"
		if parsed.port:
			netloc += f":{parsed.port}"
		url = urlunparse(parsed._replace(netloc=netloc))
	print(f"[db] connecting to {parsed.hostname}:{parsed.port}")
	async def init_conn(conn):
		await conn.execute(f"SET search_path TO {schema}, public")
		# rows = await conn.fetch(test_sql)
		# print(rows)
    
	pool = await asyncpg.create_pool(url, statement_cache_size=0, init=init_conn)
	return pool


async def close_pool():
	global pool
	if pool:
		await pool.close()
		pool = None



async def get_tables():
	# returns list of table names in public schema
	sql = f"""
		SELECT table_name
		FROM information_schema.tables
		WHERE table_schema = '{schema}' AND table_type = 'BASE TABLE'
		ORDER BY table_name
	"""
	async with pool.acquire() as conn:
		rows = await conn.fetch(sql)
	return [r["table_name"] for r in rows]


async def get_columns(table):
	# returns list of {name, type, nullable} for a table
	sql = f"""
		SELECT column_name, data_type, is_nullable
		FROM information_schema.columns
		WHERE table_schema = '{schema}'
		  AND table_name = $1
		ORDER BY ordinal_position
		LIMIT 50
	"""
	async with pool.acquire() as conn:
		rows = await conn.fetch(sql, table)
	return [
		{"name": r["column_name"], "type": r["data_type"], "nullable": r["is_nullable"]}
		for r in rows
	]


async def get_sample_rows(table, n=3):
	# returns list of dicts, up to n rows
	# safe because table name comes from information_schema, not user input
	sql = f'SELECT * FROM {schema}.{table} LIMIT {n}'
	try:
		async with pool.acquire() as conn:
			rows = await conn.fetch(sql)
		if not rows:
			print("No rows returned for SQL:", sql)
			return [], []
		columns = list(rows[0].keys())
		data = [dict(r) for r in rows]
		return columns, data
	except Exception as e:
		print("Error running SQL:", sql)
		print("Exception:", e)
		return [], []


NUMERIC_TYPES = ('int', 'float', 'numeric', 'real', 'double', 'decimal', 'date', 'timestamp')


async def get_kpi_type_dimensions(table):
    # returns dict: {kpi_type: [dim1, dim2, ...]} for tables with kpi_type + kpi_dimension columns
    sql = f"""
        SELECT kpi_type, kpi_dimension
        FROM {schema}."{table}"
        WHERE kpi_type IS NOT NULL AND kpi_type != ''
        GROUP BY kpi_type, kpi_dimension
        ORDER BY kpi_type, kpi_dimension
    """
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(sql)
        result = {}
        for r in rows:
            kt = r['kpi_type']
            kd = r['kpi_dimension'] or ''
            if kt not in result:
                result[kt] = []
            result[kt].append(kd)
        return result
    except Exception as e:
        print(f"[db] get_kpi_type_dimensions error {table}: {e}")
        return {}

async def get_column_stats(table, col_name, col_type, threshold=20):
    # returns a stats string: "values:[a,b]" or "range:[min-max]" or "N distinct"
    quoted = f'"{col_name}"'
    try:
        async with pool.acquire() as conn:
            count_row = await conn.fetchrow(f'SELECT COUNT(DISTINCT {quoted}) FROM {schema}."{table}"')
            count = count_row[0]
        if count <= threshold:
            async with pool.acquire() as conn:
                rows = await conn.fetch(f'SELECT DISTINCT {quoted} FROM {schema}."{table}" ORDER BY {quoted}')
            vals = [str(r[0]) for r in rows if r[0] is not None]
            return f"values:[{','.join(vals)}]"
        is_numeric = any(t in col_type.lower() for t in NUMERIC_TYPES)
        if is_numeric:
            async with pool.acquire() as conn:
                row = await conn.fetchrow(f'SELECT MIN({quoted}), MAX({quoted}) FROM {schema}."{table}"')
            return f"range:[{row[0]}-{row[1]}]"
        return f"{count} distinct"
    except Exception as e:
        print(f"[db] get_column_stats error {table}.{col_name}: {e}")
        return "?"


def _is_read_only(sql):
	# strip comments and whitespace, check first keyword
	stripped = re.sub(r'--[^\n]*', '', sql)
	stripped = re.sub(r'/\*.*?\*/', '', stripped, flags=re.DOTALL)
	stripped = stripped.strip().upper()
	if not stripped.startswith("SELECT") and not stripped.startswith("WITH"):
		return False
	# block dangerous keywords anywhere in the statement
	dangerous = re.compile(
		r'\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|COPY|EXECUTE|DO)\b',
		re.IGNORECASE
	)
	if dangerous.search(stripped):
		return False
	return True


async def execute_query(sql):
	# execute a read-only query, returns {columns, rows} — raises on error
	if not _is_read_only(sql):
		raise ValueError("Only SELECT / WITH queries are allowed")
	async with pool.acquire() as conn:
		await conn.execute(f"SET search_path TO {schema}, public")
		rows = await conn.fetch(sql)
	if not rows:
		return {"columns": [], "rows": []}
	columns = list(rows[0].keys())
	data = []
	for r in rows:
		row = {}
		for k, v in dict(r).items():
			if isinstance(v, (int, float, str, bool, type(None))):
				row[k] = v
			else:
				row[k] = str(v)
		data.append(row)
	return {"columns": columns, "rows": data}