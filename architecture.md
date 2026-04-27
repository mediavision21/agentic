# MediaVision - Architecture

## Overview
Agentic data analytics tool. User asks natural language questions → Claude generates SQL → executes against Supabase PostgreSQL → results displayed as table + Observable Plot chart + summary.

`node/` is the active backend. `backend/` (Python/FastAPI) is no longer used. deploy.sh targets `node/`.

## Stack
- **Backend**: Node.js 24 / node:http / pg / @rock/sqlite (native binding in `node/sqlite/`)
- **Frontend**: Vite / React 19 (vanilla JS) / Observable Plot / Mediavision brand (Gelasio + Inter, forest green)
- **LLM**: Claude API (@anthropic-ai/sdk) — Sonnet 4.6 for generation + template SQL + verify+plot+summary, Haiku 4.5 for routing
- **Database**: Supabase (PostgreSQL) — queries only `macro.nordic` (a view built from dim/fact tables)

## Directory Layout
```
mediavision/
├── .env                           # API_KEY, DATABASE_URL, SESSION_SECRET, PORT
├── node/                          # active backend
│   ├── server.js                  # node:http server; dev: Vite middleware; prod: serves frontend/dist
│   ├── router.js                  # route table (dispatch) + all HTTP handlers
│   ├── agent.js                   # pipeline orchestrator: routing → fast/slow path → unified plot+summary
│   ├── generate.js                # Sonnet SQL generation + verify_and_generate (one step)
│   ├── plot.js                    # generate_plot_and_summary (fast path)
│   ├── llm.js                     # UNIFIED Claude entrypoint — async generator for stream / tools / haiku
│   ├── db.js                      # pg pool, read-only query exec
│   ├── sqlite.js                  # SQLite wrapper: llm_logs, conversations, users, evaluations
│   ├── sqlite/                    # @rock/sqlite native N-API binding (built locally)
│   ├── auth.js                    # HMAC session tokens, rate limiting
│   ├── template_router.js         # Haiku template matcher + Sonnet SQL generator from template
│   ├── template_filters.js        # [[ AND {{var}} ]] placeholder detection + choices loader
│   ├── prompts.js                 # loads versioned YAML prompt files (plot-vN.yaml, generate-vN.yaml)
│   ├── sql_utils.js               # postprocess_sql, build_messages
│   └── data_examples.js           # cached few-shot samples + KPI combinations
├── template/                      # YAML templates (sql + plots + optional filter overrides)
│   └── evaluations/               # auto-saved from positive ("thumb up") evaluations
├── eval/
│   ├── package.json               # jsdom + @observablehq/plot for server-side SVG rendering
│   └── render_plot.mjs            # Node.js: reads {config, rows} from stdin, outputs SVG to stdout
├── eval-output/                   # gitignored — YAML files saved by eval tools
├── frontend/
│   ├── vite.config.js             # react plugin, /api + /eval proxy to :8000
│   └── src/
│       ├── main.jsx               # react root mount
│       ├── App.jsx                # root: state + /api/ask SSE consumer
│       ├── style.css              # Mediavision brand tokens, chat layout
│       ├── parseResponse.js       # LEGACY fallback for pre-migration rows
│       ├── plotUtils.js           # shared plot utility helpers
│       ├── highlight.js           # SQL syntax highlighting
│       └── components/
│           ├── ChatMessage.jsx    # iMessage-style bubble, flat round debug expandables
│           ├── EvalPanel.jsx      # conversation view with eval ratings (read-only)
│           ├── PlotEvalPanel.jsx  # Plot Eval tab: 2-versions side-by-side editor + chart + Claude score
│           ├── PlotPanel.jsx      # template result view: renders plots via ResultChart.jsx (plot_config)
│           ├── LoginDialog.jsx    # auth modal (SHA-256 hashed password)
│           ├── PromptInput.jsx    # text input (bottom bar)
│           ├── EvalSidebar.jsx    # right sidebar (Eval / Template / Plot Eval tabs)
│           ├── SqlDisplay.jsx     # collapsible <details> for SQL
│           ├── ResultTable.jsx    # tabular results, capped at top 20 rows
│           └── ResultChart.jsx    # Observable Plot inline; hard limit 30 categories; edit stays client-side
```

## Tidy / long-form output
Every SQL the LLM generates must return **long / tidy form**:
- one row per observation,
- a single numeric `value` column,
- categorical keys (`period_date`, `country`, `service`, `age_group`, `genre`, …) as separate columns.

Never pivot to wide form via `CASE WHEN`. Observable Plot groups and facets client-side using the key columns.

## Time dimension
`macro.nordic` exposes only `period_date` (ISO date, first day of the quarter month: Q1=01-01, Q2=04-01, Q3=07-01, Q4=10-01) as the sole timeseries column. The removed columns `year`, `quarter`, `quarter_label`, `period_sort`, and `period_label` no longer exist.

- **Filtering by quarter**: `EXTRACT(MONTH FROM period_date) IN (1, 7)` selects Q1 + Q3.
- **Filtering by year**: `EXTRACT(YEAR FROM period_date) IN (2023, 2024)`.
- **Year-ago comparison**: use `Date.setUTCFullYear(year - 1)` in JavaScript.
- **Display label**: derived in JS via `function fmtPeriod(s) { var d=new Date(s); return 'Q'+Math.ceil((d.getUTCMonth()+1)/3)+' '+d.getUTCFullYear(); }`.
- Template filter placeholders `[[AND {{year}}]]` and `[[AND {{quarter_label}}]]` are resolved by `template_filters.py` to EXTRACT-based SQL expressions.

## Unified Claude entrypoint — `llm.complete(options)`
Single async generator (`llm.js`). `options`:
```
{
  system, messages,
  model: "sonnet" | "haiku",
  tools: array | null,
  tool_handler: async fn | null,
  max_iterations: int (tools only, default 5),
  max_tokens, label, log_id, user, conversation_id,
  prefill: str | null,         // prepend as assistant turn (forces JSON output)
  stop_sequences: array | null // stop tokens (e.g. ["```"] for JSON prefill mode)
}
```
Each iteration (a no-tools call is a single iteration) emits:
`round` → `prompt` → `messages` → `token`* → `tool_call`* → `tool_result`* → `response`.
After the loop: `meta` with aggregated usage.

**Every tool-use iteration is its own visible round.** A 2-tool answer produces 2 rounds in the frontend debug panel, each with its own prompt / messages / response.

`llm.complete_text(options)` is a thin wrapper that collects tokens into a string (used by plot.py and template_router.py for non-streaming calls).

## API endpoints (`node/router.js`)

| Method | Path                                    | Purpose                                           |
| ------ | --------------------------------------- | ------------------------------------------------- |
| GET    | /api/health                             | Health check                                      |
| GET    | /api/me                                 | Check current session                             |
| POST   | /api/login                              | Authenticate user, set session cookie             |
| POST   | /api/ask                                | Generate SQL from prompt (SSE)                    |
| POST   | /api/sql                                | Direct SQL execution                              |
| POST   | /api/conversations                      | Create/persist a conversation                     |
| GET    | /api/conversations                      | List conversations for current user               |
| GET    | /api/conversations/{id}/evaluations     | Get evaluations for a conversation                |
| GET    | /api/conversations/{id}                 | Get all messages for a conversation               |
| POST   | /api/evaluate                           | Save evaluation; "good" → writes template YAML    |
| GET    | /api/evaluations                        | List all evaluations                              |
| GET    | /api/evaluated-sessions                 | List sessions that have been evaluated            |
| GET    | /api/admin/conversations                | All conversations grouped by user (rockie only)   |
| GET    | /api/templates                          | List all YAML templates (name, desc, category)    |
| GET    | /api/templates/{name:path}              | Run template SQL, return rows + plots             |
| GET    | /eval/files                             | List YAML files in eval-output/                   |
| GET    | /eval/files/{name}                      | Return YAML file content                          |
| POST   | /eval/render                            | Render SVG from {config, rows}                    |
| POST   | /eval/score                             | Render SVG → Claude text score (JSON)             |

## Pipeline: `/api/ask`

```
agent:
    matches = match_top_templates(prompt)          # Haiku — scores 0.0-1.0

    if matches[0].score >= 0.95:                   # Fast Path
        sql = generate_sql_from_template(prompt, template, history)   # Sonnet
        rows = run_query(sql)
        plot, summary = generate_plot_and_summary(rows)               # Sonnet (trusted, no verify)
        yield and return

    else:                                          # Slow Path
        # Skills context: schema, sample_data, kpi_info, description, how_to_resolve
        outer loop (max 4 attempts):
            sql = generate_sql(skills_context)                        # Sonnet — outputs ```sql``` block
            rows = run_query(sql)                                      # backend executes directly
            result = verify_and_generate(rows)                        # Sonnet — ONE step
            if result.ok:
                yield plot, summary, key_takeaways and return
            else:
                add failure feedback to messages, retry
```

### Stage 1 — Routing (Haiku)
System prompt = brief role + list of all template filenames + descriptions.
Model returns up to 6 candidates with similarity scores (0.0–1.0).

- **Score ≥ 0.95**: **Fast Path** (template trusted)
- **Score < 0.95**: **Slow Path** (Sonnet with skills context)
- **No match**:     **Slow Path** (open generation)

### Fast Path — Template SQL Generation (Sonnet)
`template_router.js runMatchedTemplate()`:
- Input: user prompt + conversation history + template SQL with placeholders + available choices per placeholder
- Single Sonnet call fills in all `[[ AND {{var}} ]]` placeholders from user intent and history
- Returns concrete executable SQL (always; no fallback)
- Trusted result — no verify step; goes directly to `plot.generatePlotAndSummary()`

### Slow Path — Direct SQL Generation (Sonnet)
`generate.js run()` with skills-organized system prompt:
- `## Skill: schema` — database schema
- `## Skill: sample_data` — recent sample rows
- `## Skill: kpi_info` — valid KPI combinations
- `## Skill: how_to_resolve` — intent resolution guidance
- Outer retry loop (max 4): each attempt is a single Sonnet call (no tools) that outputs SQL in a ` ```sql ``` ` block
- Backend extracts SQL, executes it directly
- After each attempt: `generate.verifyAndGenerate()` — single Sonnet call that verifies rows AND generates plot+summary
- If `ok=false`: injects `## Revision Feedback` and retries outer loop
- If SQL error: injects error feedback and retries
- If all 4 attempts exhausted: emits "Retry limit reached" round

### verify_and_generate (Sonnet, one step)
`generate.js verifyAndGenerate()` combines verification + plot+summary into one call:
- Uses plot-vN.yaml rules with a verification preamble (loaded via `prompts.js`)
- Returns `{"ok": true, "plot": {...}, "summary": "..."}` or `{"ok": false, "reason": "..."}`
- Bias toward ok=true; only rejects on clearly wrong data

### SSE rounds emitted per turn
1. **Routing** (Haiku) — always surfaced when templates loaded, even on `NONE`/errors.
2. **Template Execution** (Sonnet) — fast path only: template SQL generation round.
3. **Plot & Summary** (Sonnet) — fast path: `generate_plot_and_summary`; slow path: `verify_and_generate`.
4. **Generation / Retry N** (Sonnet) — slow path: one round per outer attempt, each with its own `prompt` / `messages` / tokens / `response`.

All calls route through `llm.js`, which prints ANSI-colored dividers tagged with model family (`[llm:haiku]` blue, `[llm:sonnet]` cyan) and persists to SQLite via `saveLog()`.

## Conversation Continuity
Prior SQL from history is extracted and passed as `## Prior Turn Context` in the slow path system prompt (under `## Skill: how_to_resolve`). Template matching always runs; if a template matches at ≥ 0.95, it generates fresh SQL from the template using history for context.

Frontend `buildHistory` (`App.jsx`) carries `{role, text, sql, intent, plot_config, columns}` for assistant turns.

## Template Format (YAML)
```yaml
category:   <group label>
description: <one-line description used in Stage 1 matching>
filters:                         # optional — overrides global filter registry
  quarter_label:
	choices: [Q1]
	default: [Q1]
sql: |
  SELECT ... [[ AND {{country}} ]] [[ AND {{year}} ]] ...
plots:
  - id: <plot_id>
	title: <display title>
	code: |                      # Observable Plot JS evaluated in browser sandbox
	  var rows = data.map(...);
	  return Plot.plot({...});
```

## Template Filters
`[[ AND {{name}} ]]` placeholders in template SQL are detected by `template_filters.js detectPlaceholders()`.
Available choices for each placeholder are resolved via `buildDefaultFilters()` and applied with `applyFilters()`.
These choices are provided as context to the Sonnet call in `runMatchedTemplate()` which fills them in based on user intent and conversation history.

## Data Flow
<pre>
User prompt
    → POST /api/ask {prompt, history, session_id}

    [Routing (Haiku)]
    → match_top_templates → top 6 + scores

    [Fast Path — score ≥ 0.95]
    → generate_sql_from_template (Sonnet) → concrete SQL
    → execute SQL → rows
    → generate_plot_and_summary (Sonnet) → plot_config + summary

    [Slow Path — score < 0.95]
    → skills prompt (schema + sample_data + kpi_info + how_to_resolve)
    → outer loop (max 4):
        → Sonnet (no tools) → SQL in ```sql``` block → backend executes → rows
        → verify_and_generate (Sonnet, ONE step) → ok + plot + summary
        → if not ok: retry with ## Revision Feedback

    → SSE events:
       conversation_id, msg_id, user_prompt,
       round, prompt, messages, token, tool_call, tool_result, response,
       sql, rows, plot_config, no_plot, summary, key_takeaways,
       suggestions, error

    → llm_logs saved per iteration with user + conversation_id
    → frontend: user bubble (right) + assistant bubble (left)
       assistant bubble: SQL collapsible, table, inline chart, one
       collapsible &lt;details&gt; per round (prompt / messages / response / tool_calls)
</pre>

## Persistence
- **SQLite** (`mediavision.db`, via `node/sqlite.js` + native binding): `llm_logs`, `conversations`, `users`, `evaluations`.
- `conversations` table: id, user, title, created_at — groups messages by session.
- `llm_logs`: each row has conversation_id + user for filtering. `GET /api/conversations/{conv_id}` filters by both conversation_id and authenticated user to prevent cross-user access.
- ID format: `conversation_id` and `msg_id` use server-generated timestamps `yyyy-mm-dd HH:mm:ss.nnnnnnnnn`.
- `result_data` on each llm_logs row stores the full assistant content dict (same shape the frontend assembles live from SSE events). `agent.js _collect()` taps every event and persists once at stream end so chat history renders identically via `ChatMessage` with zero re-derivation.

## Running

```bash
cd node && npm run dev   # serves API + frontend on :8000 via Vite middleware (dev)
```

In production, `server.js` serves `frontend/dist/` as static files.
Deploy via `deploy.sh`: builds frontend, rsync node/ + frontend/dist to server, restarts systemd service.

### Eval tools
```bash
node eval/render_plot.mjs   # reads {config, rows} from stdin, outputs SVG to stdout
# score via POST /eval/score (calls Claude with SVG text)
```

## Safety
- Read-only guard in `db.js executeQuery()` blocks anything but `SELECT` / `WITH` plus dangerous keywords.
- Table names from information_schema only (not user input).
- Session cookies are HMAC-signed (`auth.js`), expire per `SESSION_COOKIE_MAX_AGE`.
- Rate limiting on `/api/login` per IP (`auth.js checkRateLimit`).
