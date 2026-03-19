# MediaVision - Architecture

## Overview
Agentic data analytics tool. User asks natural language questions → LLM generates SQL → executes against Supabase PostgreSQL → results displayed as table + Observable Plot chart.

## Stack
- **Backend**: Python 3.13 / FastAPI / asyncpg / uv
- **Frontend**: Vite / React 19 (vanilla JS) / Observable Plot / Mediavision brand (Gelasio + Inter, forest green)
- **LLM**: Claude API (Anthropic) or local llama.cpp (qwen3.5)
- **Database**: Supabase (PostgreSQL)

## Directory Layout
```
mediavision/
├── .env                              # API_KEY, DATABASE_URL, LLM_BACKEND, LLAMA_SERVER_URL
├── backend/
│   ├── pyproject.toml                # uv managed deps
│   ├── main.py                       # FastAPI app, lifespan, CORS, routes
│   ├── db.py                         # asyncpg pool, schema introspection, query exec
│   ├── skills.py                     # generates markdown skill files from DB schema
│   ├── agent.py                      # prompt builder, SQL extraction, LLM dispatch
│   ├── llm_claude.py                 # Anthropic SDK client
│   └── llm_local.py                  # llama.cpp OpenAI-compatible HTTP client
├── frontend/
│   ├── vite.config.js                # react plugin, /api proxy to :8000
│   ├── src/
│   │   ├── main.jsx                  # react root mount
│   │   ├── App.jsx                   # root: state management, API calls
│   │   ├── style.css                 # Mediavision brand tokens, chat layout, bubble styles
│   │   └── components/
│   │       ├── ChatMessage.jsx       # iMessage-style bubble (user right, assistant left)
│   │       ├── PromptInput.jsx       # text input + backend radio selector (bottom bar)
│   │       ├── SqlDisplay.jsx        # collapsible <details> for SQL / system prompt
│   │       ├── ResultTable.jsx       # tabular results, capped at top 20 rows
│   │       └── ResultChart.jsx       # Observable Plot inline in assistant bubble
└── skills/                           # auto-generated at startup (gitignored)
    └── {table_name}.txt              # columns with distinct values or range stats per column
```

## Data Flow
```
User prompt
    → POST /api/query {prompt, backend}
    → agent.py reads skills/*.md as schema context
    → LLM generates SQL (SELECT only)
    → db.py executes in read-only transaction
    → {sql, explanation, columns, rows} returned
    → frontend renders chat messages: user bubble (right) + assistant bubble (left)
    → assistant bubble: SQL collapsed, table (top 20), chart inline
```

## API Endpoints

| Method | Path        | Purpose                              |
| ------ | ----------- | ------------------------------------ |
| POST   | /api/query  | Generate SQL from prompt, execute it |
| GET    | /api/skills | Return loaded skill files            |
| GET    | /api/health | Health check                         |

## Startup Flow
1. FastAPI lifespan creates asyncpg pool from DATABASE_URL
2. skills.py iterates `SKILL_TABLES` whitelist (user-defined in skills.py)
3. For each table: fetches columns + per-column distinct values or range → writes skills/{table}.txt
4. Server ready to accept queries

## Skill File Format
```
# macro.tablename

columns:
col_a,integer,range:[1-100]
col_b,character varying,values:[dk,sw,no]
col_c,character varying,54 distinct
```
Threshold: ≤20 distinct → list values; numeric/date high-card → `range:[min-max]`; string high-card → `N distinct`

## Running
```bash
# backend
cd backend && uv run uvicorn main:app --reload --port 8000

# frontend
cd frontend && npm run dev

# local llm (optional)
/Users/rock/git/llama.cpp/build/bin/llama-server -m <model-path> --port 8081
```

## Safety
- All user queries wrapped in `SET TRANSACTION READ ONLY`
- Skill files capped at 50 columns per table
- Table names from information_schema only (not user input)
