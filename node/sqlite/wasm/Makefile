SQLITE_SRC = ../sqlite-20260313/sqlite3.c

CFLAGS = \
    -DSQLITE_THREADSAFE=0 \
    -DSQLITE_TEMP_STORE=3 \
    -DSQLITE_ENABLE_FTS5 \
    -DSQLITE_ENABLE_JSON1 \
    -DSQLITE_ENABLE_RTREE \
    -DSQLITE_ENABLE_COLUMN_METADATA \
    -O2

EXPORTS = _sqlite3_initialize,_sqlite3_open,_sqlite3_close,_sqlite3_exec,_sqlite3_prepare_v2,_sqlite3_step,_sqlite3_finalize,_sqlite3_bind_null,_sqlite3_bind_int,_sqlite3_bind_int64,_sqlite3_bind_double,_sqlite3_bind_text,_sqlite3_bind_blob,_sqlite3_column_count,_sqlite3_column_name,_sqlite3_column_type,_sqlite3_column_int64,_sqlite3_column_double,_sqlite3_column_text,_sqlite3_column_blob,_sqlite3_column_bytes,_sqlite3_changes,_sqlite3_last_insert_rowid,_sqlite3_errmsg,_sqlite3_vfs_register,_malloc,_free

RUNTIME = UTF8ToString,stringToUTF8,lengthBytesUTF8,HEAPU8,HEAP32,addFunction

EM_FLAGS = \
    -sWASM=1 \
    -sWASM_BIGINT=1 \
    -sALLOW_MEMORY_GROWTH=1 \
    -sALLOW_TABLE_GROWTH=1 \
    -sMODULARIZE=1 \
    -sEXPORT_ES6=1 \
    -sEXPORT_NAME=SqliteModule \
    -sNO_EXIT_RUNTIME=1 \
    -sENVIRONMENT=worker \
    -sEXPORTED_FUNCTIONS=[$(EXPORTS)] \
    -sEXPORTED_RUNTIME_METHODS=[$(RUNTIME)]

all: sqlite.js

sqlite.js: $(SQLITE_SRC)
	emcc $(CFLAGS) $(EM_FLAGS) $(SQLITE_SRC) -o sqlite.js

clean:
	rm -f sqlite.js sqlite.wasm
