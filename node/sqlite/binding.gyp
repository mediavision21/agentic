{
    "targets": [{
        "target_name": "sqlite_napi",
        "sources": ["sqlite-20260313/napi-sqlite.c", "sqlite-20260313/sqlite3.c"],
        "include_dirs": ["sqlite-20260313"],
        "defines": [
            "SQLITE_THREADSAFE=1",
            "SQLITE_ENABLE_FTS5",
            "SQLITE_ENABLE_JSON1",
            "SQLITE_ENABLE_RTREE",
            "SQLITE_ENABLE_COLUMN_METADATA",
            "NAPI_DISABLE_CPP_EXCEPTIONS"
        ],
        "cflags": ["-O2"],
        "xcode_settings": {
            "OTHER_CFLAGS": ["-O2"]
        },
        "msvs_settings": {
            "VCCLCompilerTool": { "Optimization": 2 }
        }
    }]
}
