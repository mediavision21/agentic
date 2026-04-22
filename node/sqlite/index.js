import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const native = require(join(__dirname, 'build/Release/sqlite_napi.node'))

// open(path) -> db
// query(db, sql, params) -> rows[]
// run(db, sql, params) -> {changes, lastInsertRowid}
// exec(db, sql) -> void
// close(db) -> void
export const { open, close, exec, query, run } = native
