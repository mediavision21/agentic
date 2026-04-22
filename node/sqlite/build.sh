#!/bin/sh
set -e
cd "$(dirname "$0")"

SRC=sqlite-20260313

# step 1: generate amalgamation if not present
if [ ! -f "$SRC/sqlite3.c" ] || [ ! -f "$SRC/sqlite3.h" ]; then
    cd "$SRC"
    ./configure
    make sqlite3.c
    cd ..
fi

# step 2: build N-API addon
npx node-gyp@latest configure build

# step 3: build wasm module
cd wasm
make
cd ..
