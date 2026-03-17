import os
import asyncpg
from urllib.parse import urlparse, urlunparse, quote


pool = None


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
    pool = await asyncpg.create_pool(url, statement_cache_size=0)
    return pool


async def close_pool():
    global pool
    if pool:
        await pool.close()
        pool = None


async def get_tables():
    # returns list of table names in public schema
    sql = """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
        ORDER BY table_name
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql)
    return [r["table_name"] for r in rows]


async def get_columns(table):
    # returns list of {name, type, nullable} for a table
    sql = """
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
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
    sql = f'SELECT * FROM "{table}" LIMIT {n}'
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql)
    if not rows:
        return [], []
    columns = list(rows[0].keys())
    data = [dict(r) for r in rows]
    return columns, data


async def execute_query(sql):
    # execute a read-only query, returns {columns, rows}
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SET TRANSACTION READ ONLY")
            rows = await conn.fetch(sql)
    if not rows:
        return {"columns": [], "rows": []}
    columns = list(rows[0].keys())
    data = []
    for r in rows:
        row = {}
        for k, v in dict(r).items():
            # convert non-serializable types to string
            if isinstance(v, (int, float, str, bool, type(None))):
                row[k] = v
            else:
                row[k] = str(v)
        data.append(row)
    return {"columns": columns, "rows": data}
