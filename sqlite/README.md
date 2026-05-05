# @rock/sqlite

Lightweight SQLite3 N-API native binding for Node.js. Built directly from the SQLite amalgamation source in `sqlite-20260313/`.

## Build

Requires Node.js and a C compiler (Xcode CLT on macOS, build-essential on Linux).

```sh
./build.sh
```

This will:
1. Generate `sqlite3.c` / `sqlite3.h` amalgamation inside `sqlite-20260313/` if not present.
2. Compile the N-API addon via `node-gyp` into `build/Release/sqlite_napi.node`.

## Package

To package as a tarball for local install:

```sh
npm pack
```

Install from the tarball in another project:

```sh
npm install /path/to/rock-sqlite-3.51.3.tgz
```

Or install directly from the folder:

```sh
npm install /path/to/sqlite
```

## API

```js
import { open, close, exec, query, run } from '@rock/sqlite'

const db = open('./mydb.sqlite')

// create table
exec(db, `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)`)

// insert
const r = run(db, `INSERT INTO users (name) VALUES (?)`, ['Alice'])
console.log(r.lastInsertRowid) // 1

// select — returns array of row objects
const rows = query(db, `SELECT * FROM users WHERE name = ?`, ['Alice'])
console.log(rows) // [{ id: 1, name: 'Alice' }]

// update/delete
run(db, `UPDATE users SET name = ? WHERE id = ?`, ['Bob', 1])

close(db)
```

| Function         			| Returns                      | Description                        |
| ------------------------- | -----------------------------| ---------------------------------- |
| `open(path)`     			| `db`                         | Open or create a database file     |
| `exec(db, sql)`  			| `void`                       | Run one or more statements, no rows|
| `run(db, sql, [params])` 	| `{changes, lastInsertRowid}` | Execute a write statement      	|
| `query(db, sql, [params])`| `row[]`                	   | Execute a read statement           |
| `close(db)`      			| `void`                       | Close the database                 |
