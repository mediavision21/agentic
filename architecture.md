# MediaVision - Architecture

## Overview
Agentic data analytics tool. User asks natural language questions → Claude generates SQL → executes against Supabase PostgreSQL → results displayed as table + Observable Plot chart + summary.

`backend/` is the active backend (frontend + deploy.sh target it). `backend2/` has been removed.

## Stack
- **Backend**: Python 3.13 / FastAPI / asyncpg / uv  **or**  Node.js 24 / node:http / pg / @rock/sqlite (see `node/`)
- **Frontend**: Vite / React 19 (vanilla JS) / Observable Plot / Mediavision brand (Gelasio + Inter, forest green)
- **LLM**: Claude API only (Sonnet 4.6 for generation + template SQL + verify+plot+summary, Haiku 4.5 for routing)
- **Database**: Supabase (PostgreSQL) — queries only `macro.nordic` (a view built from dim/fact tables)

## Directory Layout
```
mediavision/
├── .env                           # API_KEY, DATABASE_URL, SESSION_SECRET
├── backend/                       # active backend (Claude-only)
│   ├── main.py                    # FastAPI app, /api/ask SSE, /api/sql, /api/templates, conversations, evaluations, login
│   ├── agent.py                   # pipeline orchestrator: routing → fast/slow path → unified plot+summary
│   ├── generate.py                # Sonnet tool loop + verify_and_generate (verify+plot+summary in one step)
│   ├── plot.py                    # generate_plot_and_summary (fast path) — loads prompt from plot-vN.yaml
│   ├── plot-vx.yaml               # versioned prompt (header + examples); copy to new version to iterate
│   ├── generate-v1.yaml           # SQL generation system prompt (header); loaded by generate.py
│   ├── plot-eval.py               # prompt evaluation: runs templates → LLM → SVG, saves YAML to eval-output/
│   ├── generate-eval.py           # SQL eval: runs template descriptions → intent → SQL → verify, saves YAML
│   ├── eval_router.py             # FastAPI router /eval/*: list files, render SVG, score with vision LLM
│   ├── llm.py                     # UNIFIED Claude entrypoint — one async gen for stream / tools / haiku
│   ├── db.py                      # asyncpg pool, schema introspection, read-only query exec
│   ├── evaldb.py                  # SQLite: llm_logs, conversations, users, evaluations
│   ├── intent.py                  # keyword maps + build_suggestions (no longer called in main pipeline)
│   ├── template_router.py         # Haiku template matcher + Sonnet SQL generator from template
│   ├── template_filters.py        # [[ AND {{var}} ]] placeholder detection + choices loader
│   ├── verify.py                  # verify_rows utility (standalone; no longer in main pipeline)
│   ├── sql_utils.py               # postprocess_sql, build_messages
│   ├── data_examples.py           # cached few-shot samples + KPI combinations
│   ├── sql/
│   │   └── nordic.sql             # materialized view definition (single source of data)
│   └── template/                  # YAML templates (sql + plots + optional filter overrides)
│       └── evaluations/           # auto-saved from positive ("thumb up") evaluations
├── eval/
│   ├── package.json               # jsdom + @observablehq/plot for server-side SVG rendering
│   └── render_plot.mjs            # Node.js: reads {config, rows} from stdin, outputs SVG to stdout
├── eval-output/                   # gitignored — YAML files saved by plot-eval.py
├── frontend/
│   ├── vite.config.js             # react plugin, /api proxy to :8000
│   └── src/
│       ├── main.jsx               # react root mount
│       ├── App.jsx                # root: state + /api/ask SSE consumer
│       ├── style.css              # Mediavision brand tokens, chat layout
│       ├── parseResponse.js       # LEGACY fallback for pre-migration rows
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
Single async generator. `options`:
```
{
  system, messages,
  model: "sonnet" | "haiku",
  tools: list | None,
  tool_handler: async fn | None,
  max_iterations: int (tools only, default 5),
  max_tokens, label, log_id, user, conversation_id,
  prefill: str | None,         // prepend as assistant turn (forces JSON output)
  stop_sequences: list | None  // stop tokens (e.g. ["```"] for JSON prefill mode)
}
```
Each iteration (a no-tools call is a single iteration) emits:
`round` → `prompt` → `messages` → `token`* → `tool_call`* → `tool_result`* → `response`.
After the loop: `meta` with aggregated usage.

**Every tool-use iteration is its own visible round.** A 2-tool answer produces 2 rounds in the frontend debug panel, each with its own prompt / messages / response.

`llm.complete_text(options)` is a thin wrapper that collects tokens into a string (used by plot.py and template_router.py for non-streaming calls).

## API endpoints (`backend/main.py`)

| Method | Path                                    | Purpose                                           |
| ------ | --------------------------------------- | ------------------------------------------------- |
| POST   | /api/login                              | Authenticate user, set session cookie             |
| GET    | /api/me                                 | Check current session                             |
| GET    | /api/health                             | Health check                                      |
| POST   | /api/ask                                | Generate SQL from prompt (SSE)                    |
| POST   | /api/sql                                | Direct SQL execution                              |
| POST   | /api/conversations                      | Create/persist a conversation                     |
| GET    | /api/conversations                      | List conversations for current user               |
| GET    | /api/conversations/{id}                 | Get all messages for a conversation               |
| GET    | /api/conversations/{id}/evaluations     | Get evaluations for a conversation                |
| POST   | /api/evaluate                           | Save evaluation; "good" → writes template YAML    |
| GET    | /api/evaluations                        | List all evaluations                              |
| GET    | /api/evaluated-sessions                 | List sessions that have been evaluated            |
| GET    | /api/templates                          | List all YAML templates (name, desc)              |
| GET    | /api/templates/{name:path}              | Run template SQL, return rows + plots             |
| GET    | /eval/files                             | List YAML files in eval-output/                   |
| GET    | /eval/files/{name}                      | Return YAML file content                          |
| POST   | /eval/render                            | Render SVG from {config, rows}                    |
| POST   | /eval/score                             | Render → PNG (cairosvg) → Claude vision score     |

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
        outer loop (max 5 attempts):
            inner loop (model uses query tool, max 5 iterations):
                sql = generate_sql(skills_context, tools=[query])     # Sonnet
                rows = run_query(sql)                                  # via tool
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
`template_router.generate_sql_from_template()`:
- Input: user prompt + conversation history + template SQL with placeholders + available choices per placeholder
- Single Sonnet call fills in all `[[ AND {{var}} ]]` placeholders from user intent and history
- Returns concrete executable SQL (always; no fallback)
- Trusted result — no verify step; goes directly to `plot.generate_plot_and_summary()`

### Slow Path — Tool-Loop Generation (Sonnet)
`generate.run()` with skills-organized system prompt:
- `## Skill: schema` — database schema
- `## Skill: sample_data` — recent sample rows
- `## Skill: kpi_info` — valid KPI combinations
- `## Skill: how_to_resolve` — intent resolution guidance
- Outer retry loop (max 5): each attempt runs Sonnet with `query` tool (max 5 inner iterations)
- After each attempt: `generate.verify_and_generate()` — single Sonnet call that verifies rows AND generates plot+summary
- If `ok=false`: adds failure reason to messages and retries outer loop
- If all 5 attempts exhausted: emits "Retry limit reached" round

### verify_and_generate (Sonnet, one step)
`generate.verify_and_generate()` combines what was previously two separate calls (verify_rows + generate_plot_and_summary):
- Uses plot-v3.yaml rules with a verification preamble
- Returns `{"ok": true, "plot": {...}, "summary": "..."}` or `{"ok": false, "reason": "..."}`
- Bias toward ok=true; only rejects on clearly wrong data

### SSE rounds emitted per turn
1. **Routing** (Haiku) — always surfaced when templates loaded, even on `NONE`/errors.
2. **Template Execution** (Sonnet) — fast path only: template SQL generation round.
3. **Plot & Summary** (Sonnet) — fast path: `generate_plot_and_summary`; slow path: `verify_and_generate`.
4. **Generation / Retry N** (Sonnet tool loop) — slow path: one round per outer attempt, each with its own `prompt` / `messages` / tokens + `tool_call` + `tool_result` / `response`.

All calls route through `_log_call` / `_log_response` in `llm.py`, which print ANSI-colored dividers tagged with model family (`[llm:haiku]` blue, `[llm:sonnet]` cyan).

## Conversation Continuity
Prior SQL from history is extracted and passed as `## Prior Turn Context` in the slow path system prompt (under `## Skill: how_to_resolve`). Template matching always runs; if a template matches at ≥ 0.95, it generates fresh SQL from the template using history for context.

Frontend `buildHistory` (App.jsx) carries `{role, text, sql, intent, plot_config, columns}` for assistant turns.

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
`[[ AND {{name}} ]]` placeholders in template SQL are detected by `template_filters.detect_placeholders()`.
Available choices for each placeholder are loaded via `template_filters.load_filter_choices()`.
These choices are provided as context to the Sonnet call in `generate_sql_from_template()` which fills them in based on user intent and conversation history.

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
    → outer loop (max 5):
        → Sonnet tool loop → SQL via query tool → rows
        → verify_and_generate (Sonnet, ONE step) → ok + plot + summary
        → if not ok: retry with feedback

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
- **SQLite** (`mediavision.db`): `llm_logs`, `conversations`, `users`, `evaluations`.
- `conversations` table: id, user, title, created_at — groups messages by session.
- `llm_logs`: each row has conversation_id + user for filtering. `GET /api/conversations/{conv_id}` filters by both conversation_id and authenticated user to prevent cross-user access.
- ID format: `conversation_id` and `msg_id` use server-generated timestamps `yyyy-mm-dd HH:mm:ss.nnnnnnnnn`.
- `result_data` on each llm_logs row stores the full assistant content dict (same shape the frontend assembles live from SSE events). `agent._collect()` taps every event and persists once at stream end so chat history renders identically via `ChatMessage` with zero re-derivation.

## Running

### Python backend (original)
```bash
cd backend && uv run uvicorn main:app --reload --port 8000
cd frontend && npm run dev   # runs on :5173, proxies /api to :8000
```

### Node.js backend (node/)
```bash
cd node && npm run dev   # serves API + frontend on :8000 via Vite middleware
```
Node backend layout mirrors Python module-for-module:
`server.js` → `router.js` → `agent.js` → `generate.js` / `template_router.js` / `plot.js`
`llm.js` (Anthropic SDK streaming), `db.js` (pg pool), `sqlite.js` (@rock/sqlite native binding)
Reads the same `backend/template/` YAML files and `backend/*.yaml` prompts.

### Eval tools
```bash
uv run python backend/plot-eval.py --versions v1,v2 --limit 1
uv run python backend/plot-eval.py --versions v1,v2 --template 1
```

## Safety
- Read-only guard in `db.execute_query` blocks anything but `SELECT` / `WITH` plus dangerous keywords.
- Table names from information_schema only (not user input).
- Session cookies are HMAC-signed and expire in 7 days.
