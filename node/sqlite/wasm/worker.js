import SqliteModule from './sqlite.js'
import { opfsAcquire, opfsLoad, pathToFid, registerVfs } from './vfs.js'

console.log('[worker] module loaded')

const SQLITE_OK = 0
const SQLITE_INTEGER = 1
const SQLITE_FLOAT = 2
const SQLITE_TEXT = 3
const SQLITE_BLOB = 4
const SQLITE_NULL = 5
const SQLITE_ROW = 100
const SQLITE_DONE = 101

let Module = null
let opfsRoot = null

self.onmessage = async function ({ data }) {
	const { id, type } = data
	console.log('[worker] onmessage type=' + type + ' id=' + id)
	try {
		const value = await dispatch(data)
		self.postMessage({ id, type: 'result', value })
	}
	catch (err) {
		console.log('[worker] error type=' + type + ':', err)
		self.postMessage({ id, type: 'error', message: err.message })
	}
}

async function dispatch(data) {
	const { type, db, sql, params, path } = data
	if (type === 'init') return wasmInit()
	if (type === 'open') return wasmOpen(path)
	if (type === 'load') return wasmLoad(path, data.buffer)
	if (type === 'close') return wasmClose(db)
	if (type === 'exec') return wasmExec(db, sql)
	if (type === 'query') return wasmQuery(db, sql, params)
	if (type === 'run') return wasmRun(db, sql, params)
	throw new Error('unknown type: ' + type)
}

async function wasmInit() {
	if (Module) {
		console.log('[worker] wasmInit: already initialized, skip')
		return null
	}
	console.log('[worker] wasmInit: getting opfs root')
	opfsRoot = await navigator.storage.getDirectory()
	console.log('[worker] wasmInit: loading SqliteModule')
	Module = await SqliteModule()
	console.log('[worker] wasmInit: registering vfs')
	registerVfs(Module)
	console.log('[worker] wasmInit: done')
	return null
}

function strToPtr(s) {
	const len = Module.lengthBytesUTF8(s) + 1
	const ptr = Module._malloc(len)
	Module.stringToUTF8(s, ptr, len)
	return ptr
}

async function wasmLoad(path, buffer) {
	console.log('[worker] wasmLoad:', path, 'bytes:', buffer?.byteLength)
	if (!Module) throw new Error('not initialized, call init() first')
	await opfsLoad({ opfsRoot, path, buffer })
	return wasmOpen(path)
}

async function wasmOpen(path) {
	console.log('[worker] wasmOpen:', path)
	if (!Module) throw new Error('not initialized, call init() first')
	if (!pathToFid.has(path)) {
		await opfsAcquire({ opfsRoot, path })
	}
	console.log('[worker] opfsAcquire done')
	const pathPtr = strToPtr(path)
	const dbPtrPtr = Module._malloc(4)
	const rc = Module._sqlite3_open(pathPtr, dbPtrPtr)
	const db = Module.HEAP32[dbPtrPtr >> 2]
	Module._free(pathPtr)
	Module._free(dbPtrPtr)
	if (rc !== SQLITE_OK) {
		const msg = db ? Module.UTF8ToString(Module._sqlite3_errmsg(db)) : 'sqlite3_open failed'
		throw new Error(msg)
	}
	// use memory journal to avoid sqlite opening extra files
	const pragmaPtr = strToPtr('PRAGMA journal_mode=MEMORY')
	Module._sqlite3_exec(db, pragmaPtr, 0, 0, 0)
	Module._free(pragmaPtr)
	return db
}

function wasmClose(db) {
	Module._sqlite3_close(db)
	return null
}

function wasmExec(db, sql) {
	const sqlPtr = strToPtr(sql)
	const rc = Module._sqlite3_exec(db, sqlPtr, 0, 0, 0)
	Module._free(sqlPtr)
	if (rc !== SQLITE_OK) {
		throw new Error(Module.UTF8ToString(Module._sqlite3_errmsg(db)))
	}
	return null
}

function bindParams(stmt, params) {
	for (let i = 0; i < params.length; i++) {
		const v = params[i]
		const idx = i + 1
		if (v === null || v === undefined) {
			Module._sqlite3_bind_null(stmt, idx)
		}
		else if (typeof v === 'number') {
			if (Number.isInteger(v)) {
				Module._sqlite3_bind_int(stmt, idx, v)
			}
			else {
				Module._sqlite3_bind_double(stmt, idx, v)
			}
		}
		else if (typeof v === 'bigint') {
			Module._sqlite3_bind_int64(stmt, idx, v)
		}
		else if (typeof v === 'string') {
			const sPtr = strToPtr(v)
			Module._sqlite3_bind_text(stmt, idx, sPtr, -1, -1) // -1 = SQLITE_TRANSIENT
			Module._free(sPtr)
		}
		else if (v instanceof Uint8Array || v instanceof ArrayBuffer) {
			const bytes = v instanceof ArrayBuffer ? new Uint8Array(v) : v
			const bPtr = Module._malloc(bytes.byteLength)
			Module.HEAPU8.set(bytes, bPtr)
			Module._sqlite3_bind_blob(stmt, idx, bPtr, bytes.byteLength, -1)
			Module._free(bPtr)
		}
	}
}

function readRow(stmt, colCount) {
	const row = {}
	for (let c = 0; c < colCount; c++) {
		const name = Module.UTF8ToString(Module._sqlite3_column_name(stmt, c))
		const type = Module._sqlite3_column_type(stmt, c)
		let val = null
		if (type === SQLITE_INTEGER) {
			val = Module._sqlite3_column_int64(stmt, c)
		}
		else if (type === SQLITE_FLOAT) {
			val = Module._sqlite3_column_double(stmt, c)
		}
		else if (type === SQLITE_TEXT) {
			val = Module.UTF8ToString(Module._sqlite3_column_text(stmt, c))
		}
		else if (type === SQLITE_BLOB) {
			const ptr = Module._sqlite3_column_blob(stmt, c)
			const len = Module._sqlite3_column_bytes(stmt, c)
			val = Module.HEAPU8.slice(ptr, ptr + len).buffer
		}
		row[name] = val
	}
	return row
}

function prepareAndBind(db, sql, params) {
	const sqlPtr = strToPtr(sql)
	const stmtPtrPtr = Module._malloc(4)
	const rc = Module._sqlite3_prepare_v2(db, sqlPtr, -1, stmtPtrPtr, 0)
	Module._free(sqlPtr)
	const stmt = Module.HEAP32[stmtPtrPtr >> 2]
	Module._free(stmtPtrPtr)
	if (rc !== SQLITE_OK) {
		throw new Error(Module.UTF8ToString(Module._sqlite3_errmsg(db)))
	}
	bindParams(stmt, params)
	return stmt
}

function wasmQuery(db, sql, params) {
	const stmt = prepareAndBind(db, sql, params)
	const colCount = Module._sqlite3_column_count(stmt)
	const rows = []
	let rc = Module._sqlite3_step(stmt)
	while (rc === SQLITE_ROW) {
		rows.push(readRow(stmt, colCount))
		rc = Module._sqlite3_step(stmt)
	}
	Module._sqlite3_finalize(stmt)
	if (rc !== SQLITE_DONE) {
		throw new Error(Module.UTF8ToString(Module._sqlite3_errmsg(db)))
	}
	return rows
}

function wasmRun(db, sql, params) {
	const stmt = prepareAndBind(db, sql, params)
	const rc = Module._sqlite3_step(stmt)
	Module._sqlite3_finalize(stmt)
	if (rc !== SQLITE_DONE && rc !== SQLITE_ROW) {
		throw new Error(Module.UTF8ToString(Module._sqlite3_errmsg(db)))
	}
	return {
		changes: Module._sqlite3_changes(db),
		lastInsertRowid: Module._sqlite3_last_insert_rowid(db)
	}
}
