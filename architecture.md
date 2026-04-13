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
│   ├── intent.py                     # Stage 0: intent extraction + default resolution (pure Python, no LLM)
│   ├── agent.py                      # pipeline orchestrator: intent → routing → template exec / tool-loop generation
│   ├── generate.py                   # tool-loop SQL generation — LLM with `query` tool + optional template hints
│   ├── sql_utils.py                  # SQL post-processing, extraction, message-building helpers
│   ├── plot_config.py                # plot+summary LLM call; loads rules from skill/plot.md at runtime
│   ├── template_router.py            # YAML template loader + Haiku-based prompt matcher
│   ├── template_filters.py           # global filter registry ([[ AND {{var}} ]] substitution)
│   ├── template/                     # pre-baked YAML templates (sql + plot code + optional filter overrides)
│   ├── evaldb.py                     # SQLite: llm_logs, evaluations, users, conversations
│   ├── add_user.py                   # CLI tool to create users
│   ├── llm.py                        # backend-agnostic wrapper (complete / complete_stream / complete_with_tools_stream)
│   ├── llm_claude.py                 # Anthropic SDK client (tool-use streaming loop lives here)
│   └── llm_local.py                  # llama.cpp OpenAI-compatible HTTP client
├── frontend/
│   ├── vite.config.js                # react plugin, /api proxy to :8000
│   ├── src/
│   │   ├── main.jsx                  # react root mount
│   │   ├── App.jsx                   # root: state management, API calls
│   │   ├── style.css                 # Mediavision brand tokens, chat layout, bubble styles
│   │   ├── parseResponse.js          # LEGACY fallback — pre-migration rows only (new rows use result_data as-is)
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

## Conversation Continuity

Follow-up questions default to **continuation** unless the new prompt is clearly a new topic. `agent.is_continuation(partial, prior_ctx)`:
- Returns `True` when the prior assistant turn had stored `sql` + `intent`, AND either:
  - `is_data_query(partial)` is False (pure modifier: "add Q1 2024", "även lägga till"), OR
  - `is_data_query(partial)` is True but **none** of the strong signals fired (`kpi_type`, `service_ids`, `top_n`, `countries`, `category`, `service_filter`).
- Returns `False` only when the new prompt has at least one strong signal AND reads as self-contained.

On continuation:
- Prior resolved intent is merged with the current partial (partial fields override), re-resolved, and used for preamble + intent_block.
- Template routing (Stage 1) is **skipped** — follow-ups always go through tool-loop generation (label: "Follow-up Generation").
- Prior SQL is injected into the generation system prompt under `## Prior Turn Context (modify, do not replace)`.
- Prior `plot_config` is passed to `generate_plot_and_summary` so the plot LLM extends the existing chart instead of regenerating from scratch.

Frontend `buildHistory` (App.jsx) carries `{role, text, sql, intent, plot_config, columns}` for assistant turns so the backend can reconstruct prior context.

## Pipeline: Intent Resolution → Routing → Generation

### Stage 0 — Intent Resolution (Python, no LLM, <5ms)
Before any LLM call, `intent.py` extracts structured intent from the user prompt using keyword matching:
- Extracts: kpi_type, kpi_dimension, category, countries, services, time period, top_n
- Detects service filter context (streaming/social/AVOD/FAST/public service) → maps to `is_*` boolean flags on `macro.nordic`
- Detects "video type comparison" queries → sets multi-dimension mode (svod, ssvod, bsvod, hvod, tve, pay_tv_channel)
- Fills missing slots with sensible defaults per `skills/IntentionResolution.md` rules
- Emits a `preamble` SSE event describing what was assumed
- Generates a "Resolved Query Intent" block injected into LLM system prompts
- Generates contextual follow-on suggestions (geographic drill, time drill, metric switch)

**Core principle: generate first, refine after.** Never block on a missing filter. Apply defaults, show data, offer refinements.

**Key mapping note**: `macro.nordic` strips `_service` from kpi_type (via REGEXP_REPLACE). Service-level rows are identified by `canonical_name IS NOT NULL`.

**Service flag columns** (denormalized from `dim_service` onto `macro.nordic`): `is_streaming_service`, `is_social_video`, `is_avod`, `is_fast`, `is_public_service`. Use directly in WHERE — no join needed.

### Stage 1 — Routing (Haiku, fast + cheap)
System prompt contains only: brief role description + list of all template filenames and their `description` fields.
User prompt is matched against this list. Model returns up to 6 candidates with a similarity score (0.0–1.0).

- **Score >= 0.95**: Stage 2 variant = **Template Execution**
- **Score < 0.95** (partial matches): Stage 2 = **Guided Generation** — tool loop with top 3 templates as hints
- **No match**: Stage 2 = **Open Generation** — tool loop with schema only

### Stage 2a — Template Execution
Use template SQL directly — no SQL generation needed.
- Step: SQL — if template SQL has `[[ AND {{var}} ]]` placeholders, resolve from: (1) user prompt via LLM, (2) intent defaults, (3) registry defaults. Execute SQL, stream rows.
- Step: Plot & Summary — render template plot code, generate summary.

### Stage 2b — Tool-Loop Generation (Sonnet)
Single unified stage for both guided (partial match) and open (no match) cases — the only difference is whether the system prompt includes matched-template few-shot examples.

**Step: SQL** (streaming, tool-use loop): system prompt = role + schema (fetched from DB, cached) + sample data CSV + resolved intent block + (optional) top 3 template SQL as few-shot examples. The LLM is given a single `query` tool that runs a read-only SELECT against `macro.nordic` and returns `{columns, row_count, rows (top 20)}`. The model may call the tool multiple times in one turn:
- Typical path: one `query` call → rows returned → model responds with a short plain-text summary.
- Empty-result recovery: if a call returns 0 rows, the result is fed back to the model as `tool_result` so it can call `query` again — e.g. `SELECT DISTINCT country FROM macro.nordic WHERE kpi_type = '...'` — and then issue a corrected query.

The loop terminates when the model emits `end_turn` or after `max_iterations = 5`. The last tool call that returned rows is emitted as the canonical `sql` + `rows` event for the UI and plot+summary step.

**Step: Plot & Summary** (after rows confirmed): sample rows sent to a separate LLM call that returns a combined JSON with `plot` (Observable Plot config) and `summary` (2-4 sentence text). Uses `skill/plot.md` rules (chart type selection: grouped bars for period comparison via `fx`, stacked bars for share data, lines for trends). No schema/SQL rules are included in this prompt.

> **Schema source**: `fetch_schema_text()` in `db.py` queries `information_schema` for tables listed in `schema_tables` (currently `['nordic']`), builds a markdown table of columns/types/stats, and caches in-process.

> **Sample data**: `load_data_examples()` runs a one-time query against `macro.nordic` (latest quarter, sweden + norway, 5 KPI types, ≤5 rows each ≈ 50 rows). Result cached in-process as CSV and appended to the Stage 2b system prompt.

> **Tool-loop plumbing**: `llm_claude.complete_with_tools_stream` drives the Anthropic tool-use loop — streams text deltas, calls `tool_handler` on each `tool_use` block, appends assistant + `tool_result` messages, and continues until `stop_reason != "tool_use"` or `max_iterations` is reached. `generate.run` wires the `query` tool to `db.execute_query` (with `postprocess_sql` applied first).

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

Three resolution paths (in priority order):
1. **LLM extraction**: fast Haiku call extracts filter values from user message
2. **Intent defaults**: resolved intent fills filters (country, year, quarter from intent)
3. **Registry defaults**: global FILTER_REGISTRY defaults as last resort
Only asks the user if all three fail (very rare).

## Data Flow
```
User prompt
    → POST /api/query {prompt, backend, history, session_id}

    [Stage 0 — Intent Resolution (Python, no LLM)]
    → extract_intent(): keyword-match kpi_type, services, countries, time, top_n
    → resolve_defaults(): fill missing slots per IntentionResolution.md rules
    → emit preamble SSE event ("Showing SVOD penetration — Nordic average, latest vs year-ago")
    → build intent_block for LLM system prompt injection

    [Stage 1 — Routing (Haiku)]
    → template_router: load all YAML templates
    → Haiku matches prompt vs. template descriptions → top 6 with scores

    [Stage 2 — Template Execution (score >= 0.95)]
    → Step: SQL — detect [[ {{placeholders}} ]] in template SQL
        → resolve filters: LLM → intent defaults → registry defaults
        → execute SQL → stream rows
    → Step: Plot & Summary — render template plot code + generate summary

    [Stage 2 — Tool-Loop Generation (partial or no match, Sonnet)]
    → Step: SQL (streaming, tool-use loop):
        → system prompt = schema + sample data + intent_block (+ top 3 templates if matched)
        → LLM calls `query` tool to run SELECT; rows returned as tool_result
        → on 0 rows: LLM may call `query` again (e.g. distinct-value probe) and retry
        → loop until end_turn or max_iterations=5; last successful query → canonical sql+rows
    → Step: Plot & Summary: sample rows → separate LLM call → plot config + summary

    → emit intent-based suggestions ("Break down by country", "Show trend", "Switch to reach")

    → SSE events: conversation_id, msg_id, preamble, intent, round, token, sql, rows, plot_config, template_plots, summary, suggestions, prompt, messages, response, distilled_summary
    → llm_logs saved with user + conversation_id
    → frontend: user bubble (right) + assistant bubble (left)
    → assistant bubble: SQL collapsible, table, chart inline, flat round debug expandables (each round: Prompt/Messages/Response; SQL + plot distilled out as separate blocks)
```

## Persistence
- **SQLite** (`mediavision.db`): llm_logs, evaluations, users, conversations
- **conversations** table: id, user, title, created_at — groups messages by session
- **llm_logs**: each row has conversation_id + user for filtering
- **ID format**: both `conversation_id` and `llm_logs.id` (msg_id) use server-generated timestamps `yyyy-mm-dd HH:mm:ss.nnnnnnnnn` (nanosecond precision via microsecond×1000). `conversation_id` is generated on the first message of a session and reused for all subsequent messages. `msg_id` is generated per LLM interaction.
- Chat history loaded per-user on login, lazy-loaded on click
- Eval view loads full conversation from conversation_id
- **result_data** on each llm_logs row stores the *full* assistant content dict
  (same shape the frontend assembles live from SSE events — msg_id, preamble,
  intent, text, raw_text, sql, explanation, plot_config, columns, rows, summary,
  suggestions, template_plots, distilled_summary, rounds, error). `agent.py`
  taps every event via `_collect()` and persists once at stream end, so chat
  history renders identically to live streaming via the same ChatMessage
  component with zero re-derivation. `parseResponse.js` remains as a legacy
  fallback for pre-migration rows.

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
