# MediaVision - Architecture

## Overview
Agentic data analytics tool. User asks natural language questions → LLM generates SQL → executes against Supabase PostgreSQL → results displayed as table + Observable Plot chart + summary.

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
│   ├── skills.py                     # generates skill files from DB schema (files kept, not used in prompt)
│   ├── agent.py                      # three-stage orchestrator: template → guided LLM → full schema LLM
│   ├── stage2.py                     # template-guided SQL generation (2 tries × 3 templates)
│   ├── stage3.py                     # full-schema fallback SQL generation
│   ├── plot_config.py                # plot+summary LLM call; loads rules from skill/plot.md at runtime
│   ├── template_router.py            # YAML template loader + Haiku-based prompt matcher
│   ├── template_filters.py           # global filter registry ([[ AND {{var}} ]] substitution)
│   ├── template/                     # pre-baked YAML templates (sql + plot code + optional filter overrides)
│   ├── evaldb.py                     # SQLite: llm_logs, evaluations, users, conversations
│   ├── add_user.py                   # CLI tool to create users
│   ├── llm_claude.py                 # Anthropic SDK client
│   └── llm_local.py                  # llama.cpp OpenAI-compatible HTTP client
├── frontend/
│   ├── vite.config.js                # react plugin, /api proxy to :8000
│   ├── src/
│   │   ├── main.jsx                  # react root mount
│   │   ├── App.jsx                   # root: state management, API calls
│   │   ├── style.css                 # Mediavision brand tokens, chat layout, bubble styles
│   │   ├── parseResponse.js          # parse raw LLM text → structured content for ChatMessage
│   │   └── components/
│   │       ├── ChatMessage.jsx       # iMessage-style bubble (user right, assistant left)
│   │       ├── EvalPanel.jsx         # full conversation view for evaluations (read-only)
│   │       ├── TemplatePanel.jsx     # template result view: runs SQL + renders all plots
│   │       ├── LoginDialog.jsx       # auth modal (SHA-256 hashed password)
│   │       ├── PromptInput.jsx       # text input + backend radio selector (bottom bar)
│   │       ├── SkillsSidebar.jsx     # right sidebar: skills + eval tabs
│   │       ├── SkillEditor.jsx       # markdown skill template editor
│   │       ├── SqlDisplay.jsx        # collapsible <details> for SQL / system prompt
│   │       ├── ResultTable.jsx       # tabular results, capped at top 20 rows
│   │       └── ResultChart.jsx       # Observable Plot inline in assistant bubble
└── skills/                           # auto-generated at startup (kept on disk, not injected into prompts)
    └── {table_name}.txt              # columns with distinct values or range stats per column
```

## Three-Stage LLM Pipeline

### Stage 1 — Template Matching (Haiku, fast + cheap)
System prompt contains only: brief role description + list of all template filenames and their `description` fields.
User prompt is matched against this list. Model returns up to 6 candidates with a similarity score (0.0–1.0).

- **Score ≥ 0.95 (full match)**: use template SQL directly — no SQL generation needed.
  - If template SQL has `[[ AND {{var}} ]]` placeholders, run filter resolution (see Template Filters below).
  - Execute SQL, stream rows, render template plot code, generate summary.
- **Score < 0.95**: proceed to Stage 2 with top matches as few-shot examples.
- **No match**: skip Stage 2, go directly to Stage 3.

### Stage 2 — Template-Guided SQL Generation (Sonnet)
Runs only when Stage 1 found partial matches. Two-step LLM process:

**SQL step** (streaming): system prompt = role + schema + sample data CSV + top 3 template matches as few-shot examples. LLM returns PRIMARY sql block + optional ALTERNATIVE sql blocks. Each is tried in order until one returns rows.
- If all alternatives return 0 rows: **Try 2** (non-streaming) repeats with template matches 4–6.
- If all tries return 0 rows → hand off to Stage 3.

**Plot+summary step** (after rows confirmed): sample rows sent to a single LLM call that returns a combined JSON with `plot` (Observable Plot config) and `summary` (2-4 sentence text). Uses `skill/plot.md` rules: always `period_label` on x-axis, never `year`/`quarter_label`; `period_sort` used only for sorting.

### Stage 3 — Full Schema Fallback (Sonnet)
Runs when Stage 1 found no matches, or Stage 2 returned no data. Same two-step process:

**SQL step** (streaming): system prompt = role + complete SKILL.md schema (no template hints). LLM returns SQL + alternatives. Each tried until rows found.
**Plot+summary step**: single LLM call generates Observable Plot config + summary from sample rows.

> **Sample data**: `load_data_examples()` in `stage2.py` runs a one-time query against `macro.nordic` (latest quarter, sweden + norway, 5 KPI types, ≤5 rows each ≈ 50 rows). Result cached in-process as CSV and appended to both Stage 2 and Stage 3 system prompts.

> **Note:** The `skills/` directory files (per-column stats) are generated at startup and kept on disk for reference, but are **not injected** into any prompt. Templates and the `nordic.sql` schema description serve as the primary context.

## Template Format (YAML)
```yaml
category: <group label>
description: <one-line description used in Stage 1 matching>
filters:                        # optional — overrides global filter registry per-placeholder
  quarter_label:
    choices: [Q1]
    default: [Q1]
sql: |
  SELECT ... [[ AND {{country}} ]] [[ AND {{year}} ]] ...
plots:
  - id: <plot_id>
    title: <display title>
    code: |                     # Observable Plot JS evaluated in browser sandbox
      var rows = data.map(...);
      return Plot.plot({...});
```

## Template Filters
Metabase-style `[[ AND {{name}} ]]` placeholders in SQL are resolved before execution.

**Global registry** (`template_filters.py`): defines choices + defaults for `country`, `year`, `quarter_label`.
**Per-YAML override**: a template's `filters` key overrides specific fields (e.g. restrict `quarter_label` to `[Q1]` only).

Two resolution paths:
- **Right-panel click** (`GET /api/templates/{name}`): substitutes defaults automatically, no user input needed.
- **Chat query** (full match in Stage 1): runs a fast LLM call to extract filter values from the user's message. If none found, asks the user with a `<!--suggestions-->` block.

## Data Flow
```
User prompt
    → POST /api/query {prompt, backend, history, session_id}

    [Stage 1 — Haiku]
    → template_router: load all YAML templates
    → Haiku matches prompt vs. template descriptions → top 6 with scores

    [Full match ≥ 0.95]
    → detect [[ {{placeholders}} ]] in template SQL
    → if placeholders: fast LLM call extracts filter values from prompt
        → if no values found: ask user (suggestions block), stop
        → if values found: substitute into SQL
    → execute SQL → stream rows + template plot code + summary

    [Partial match → Stage 2 — Sonnet]
    → SQL step (streaming): top 3 templates as examples → LLM returns SQL + alternatives
    → try each SQL in order until rows found
    → if all return 0 rows: try2 with templates 4-6 (non-streaming), same SQL-try loop
    → if all tries return 0 rows: hand off to Stage 3

    [No match, or Stage 2 returned no data → Stage 3 — Sonnet]
    → SQL step (streaming): full SKILL.md schema, no template hints → SQL + alternatives
    → try each SQL in order until rows found

    [After rows found — Stage 2 or Stage 3]
    → Plot step: sample rows sent to separate LLM call → Observable Plot config JSON
    → generate summary

    → SSE events: msg_id, token, sql, rows, plot_config, template_plots, summary, suggestions
    → llm_logs saved with user + conversation_id
    → frontend: user bubble (right) + assistant bubble (left)
    → assistant bubble: SQL collapsible, table, chart inline
```

## Persistence
- **SQLite** (`mediavision.db`): llm_logs, evaluations, users, conversations
- **conversations** table: id, user, title, created_at — groups messages by session
- **llm_logs**: each row has conversation_id + user for filtering
- Chat history loaded per-user on login, lazy-loaded on click
- Eval view loads full conversation from conversation_id

## API Endpoints

| Method | Path                        | Purpose                                  |
| ------ | --------------------------- | ---------------------------------------- |
| POST   | /api/login                  | Authenticate user, set session cookie    |
| GET    | /api/me                     | Check current session                    |
| POST   | /api/query                  | Generate SQL from prompt, execute it     |
| POST   | /api/sql                    | Direct SQL execution                     |
| GET    | /api/skills                 | Return loaded skill files                |
| GET    | /api/skill-templates        | List skill template files                |
| GET    | /api/skill-templates/{name} | Read a skill template                    |
| PUT    | /api/skill-templates/{name} | Update a skill template                  |
| PATCH  | /api/messages/{id}/plot_config | Update saved plot config for a message |
| POST   | /api/evaluate               | Save evaluation rating/comment           |
| GET    | /api/evaluations            | List all evaluations with logs           |
| POST   | /api/conversations          | Create/persist a conversation            |
| GET    | /api/conversations          | List conversations for current user      |
| GET    | /api/conversations/{id}     | Get all messages for a conversation      |
| GET    | /api/templates              | List all YAML templates (name, desc, status) |
| GET    | /api/templates/{name}       | Run template SQL, return rows + plots    |
| GET    | /api/health                 | Health check                             |

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
