# sqlite

Two independent SQLite bindings from the same source (`sqlite-20260313/`).

## Node.js native addon (`index.js`)

- `napi-sqlite.c` — N-API binding (~290 lines): open, close, exec, query, run
- `binding.gyp` — node-gyp build; defines SQLITE_THREADSAFE=1, FTS5, JSON1, RTREE
- `build.sh` — runs sqlite configure + node-gyp build
- Output: `build/Release/sqlite_napi.node`
- API is synchronous

## Browser WASM (`wasm/`)

- `Makefile` — emscripten build; produces `sqlite.js` + `sqlite.wasm`
- `vfs.js` — OPFS VFS implemented in JS: writes sqlite3_vfs and sqlite3_io_methods structs into WASM heap, registers via `_sqlite3_vfs_register`; uses `FileSystemSyncAccessHandle` for all I/O (synchronous inside a Web Worker)
- `worker.js` — Dedicated Web Worker: loads wasm, registers OPFS VFS, handles postMessage dispatch; calls raw sqlite3 exported functions (prepare_v2, step, column_*, etc.)
- `index.js` — Main thread: creates Worker, wraps messages in promise-based API
- API is async (Promise-based); requires HTTPS or localhost (OPFS constraint)

### Key design choices
- VFS entirely in JS, no custom C — registered via emscripten `addFunction` + struct writes
- Async OPFS handle acquisition (`createSyncAccessHandle`) happens in the worker message handler before calling into C; after that all C-side I/O is synchronous
- `PRAGMA journal_mode=MEMORY` prevents sqlite3 from opening secondary files (journal/WAL)
- `SQLITE_THREADSAFE=0` — single-threaded, all access through one worker
