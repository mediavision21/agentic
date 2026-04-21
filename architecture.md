# MediaVision - Architecture

## Overview
Agentic data analytics tool. User asks natural language questions → Claude generates SQL → executes against Supabase PostgreSQL → results displayed as table + Observable Plot chart + summary.

`backend/` is the active backend (frontend + deploy.sh target it). `backend2/` has been removed.

## Stack
- **Backend**: Python 3.13 / FastAPI / asyncpg / uv
- **Frontend**: Vite / React 19 (vanilla JS) / Observable Plot / Mediavision brand (Gelasio + Inter, forest green)
- **LLM**: Claude API only (Sonnet 4.6 for generation, Haiku 4.5 for routing + filter resolution)
- **Database**: Supabase (PostgreSQL) — queries only `macro.nordic` (a view built from dim/fact tables)

## Directory Layout
```
mediavision/
├── .env                           # API_KEY, DATABASE_URL, SESSION_SECRET
├── backend/                       # active backend (Claude-only)
│   ├── main.py                    # FastAPI app, /api/ask SSE, /api/sql, /api/templates, conversations, evaluations, login
│   ├── agent.py                   # pipeline orchestrator: intent → routing → template exec / tool-loop
│   ├── generate.py                # Sonnet tool loop — single `query` tool against macro.nordic (long/tidy form)
│   ├── plot.py                    # plot+summary JSON generator — loads prompt from plot-vN.yaml
│   ├── plot-v1.yaml               # versioned prompt (header + examples); copy to plot-v2.yaml to iterate
│   ├── plot-eval.py               # prompt evaluation: runs templates → LLM → SVG, saves YAML to eval-output/
│   ├── eval_router.py             # FastAPI router /eval/*: list files, render SVG, score with vision LLM
│   ├── llm.py                     # UNIFIED Claude entrypoint — one async gen for stream / tools / haiku
│   ├── db.py                      # asyncpg pool, schema introspection, read-only query exec
│   ├── evaldb.py                  # SQLite: llm_logs, conversations, users, evaluations
│   ├── intent.py                  # keyword-based intent extraction + default resolution (no LLM)
│   ├── template_router.py         # Haiku template matcher + filter resolution + template runner
│   ├── template_filters.py        # [[ AND {{var}} ]] placeholder registry + apply_filters
│   ├── verify.py                  # verify_rows — Haiku semantic check on query results
│   ├── sql_utils.py               # postprocess_sql, build_messages
│   ├── data_examples.py           # cached few-shot samples + KPI combinations
│   ├── sql/
│   │   └── nordic.sql             # materialized view definition (single source of data)
│   └── template/                  # YAML templates (sql + plots + optional filter overrides)
│       └── evaluations/           # auto-saved from positive ("good") evaluations
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
│           ├── PlotEvalPanel.jsx  # Plot Eval tab: N-version side-by-side editor + chart + Claude score
│           ├── PlotPanel.jsx      # template result view: renders plots via ResultChart.jsx (plot_config)
│           ├── LoginDialog.jsx    # auth modal (SHA-256 hashed password)
│           ├── PromptInput.jsx    # text input (bottom bar)
│           ├── EvalSidebar.jsx    # right sidebar (Eval / Template / Plot Eval tabs)
│           ├── SkillEditor.jsx    # markdown skill template editor (unused with backend2)
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
    templates = match_template(prompt)            # Haiku
    match_sql = apply_filters(top.sql) if top.score >= 0.95 else None
    loop(templates, match_sql)

loop(templates, match_sql):
    sql = match_sql or generate_sql(template_hints=templates[:3])
    inner loop (max 5 iterations):
        rows = run_query(sql)
        verify(rows, user_prompt)                 # Haiku — NEW
        if ok:
            plot, summary, key_takeaways = generate_plot_and_summary(rows)
            yield and return
        else:
            sql = generate_sql(feedback=reason, template_hints)
```

### Stage 0 — Intent Resolution (Python, no LLM, <5ms)
`intent.py` extracts structured intent from the user prompt using keyword matching:
- Extracts: kpi_type, kpi_dimension, category, countries, services, time period, top_n
- Service filter context (streaming/social/AVOD/FAST/public service) → `is_*` flags on `macro.nordic`
- Video type comparison → multi-dimension mode (svod, ssvod, bsvod, hvod, tve, pay_tv_channel)
- Fills missing slots with sensible defaults
- Emits `preamble` SSE describing what was assumed
- Injects a "Resolved Query Intent" block into LLM system prompts
- Generates follow-on suggestions via `build_suggestions(intent)` — used only when the LLM did not emit `<!--suggestions-->` in its own text

**Core principle: generate first, refine after.** Never block on a missing filter.

### Stage 1 — Routing (Haiku)
System prompt = brief role + list of all template filenames + descriptions.
Model returns up to 6 candidates with similarity scores (0.0–1.0).

- **Score ≥ 0.95**: Stage 2 = **Template Execution**
- **Score < 0.95**: Stage 2 = **Guided Generation** (top 3 templates as hints)
- **No match**:     Stage 2 = **Open Generation**

### Stage 2a — Template Execution
Use template SQL directly; results are **buffered** and verified before yielding to client.
- SQL step — if the template has `[[ AND {{var}} ]]` placeholders, resolve from: (1) user prompt via Haiku, (2) intent defaults, (3) registry defaults. Execute, collect rows.
- **Verify** (`verify.py`, Haiku) — rule-based (empty/all-null) then semantic check. If `ok=False`, discard template result and fall through to Stage 2b with `template_fallback_feedback` injected into the system prompt.
- Plot & Summary — render template plot code, generate summary via Sonnet.

### Stage 2b — Tool-Loop Generation (Sonnet)
Unified for guided + open + follow-up continuations + template fallback. `generate.run` wires the `query` tool to `db.execute_query` (with `postprocess_sql` applied first). Loop ends at `stop_reason != "tool_use"` or `max_iterations=5`.
After each query with non-empty rows, `verify.py` checks semantic correctness. Failure appends a `VERIFICATION FAILED` note to the tool result so Sonnet revises the SQL; `last_success` is only updated on a passing check.

### SSE rounds emitted per turn
1. **Routing** (Haiku) — always surfaced when templates loaded, even on `NONE`/errors. Skipped on continuations.
2. **Filter Resolution** (Haiku) — when a matched template has placeholders.
3. **generate iter=0 / iter=1 / …** (Sonnet tool loop) — one round per LLM iteration, each with its own `prompt` / `messages` / tokens + `tool_call` + `tool_result` / `response`.
4. **Plot & Summary** (Sonnet, non-streaming) — `prompt` / `messages` / `response` / `plot_config` / `summary`. Skipped (emits `no_plot`) when result has ≤1 row.

All calls route through `_log_call` / `_log_response` in `llm.py`, which print ANSI-colored dividers tagged with model family (`[llm:haiku]` blue, `[llm:sonnet]` cyan).

## Conversation Continuity
`agent.is_continuation(partial, prior_ctx)`:
- `True` when the prior assistant turn had stored `sql` + `intent`, AND either `is_data_query(partial)` is False (pure modifier), OR True but **none** of the strong signals fired (`kpi_type`, `service_ids`, `top_n`, `countries`, `category`, `service_filter`).
- `False` when the new prompt has a strong signal and reads self-contained.

On continuation: prior intent merged with current partial, template routing **skipped**, prior SQL injected under `## Prior Turn Context (modify, do not replace)`, prior `plot_config` forwarded to the plot step so the chart is extended rather than rebuilt.

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
`[[ AND {{name}} ]]` placeholders resolved before execution.
Global registry in `template_filters.py`; per-YAML overrides via the `filters` key.
Resolution priority: (1) Haiku extraction from user prompt, (2) intent defaults, (3) registry defaults. Only asks the user if all three fail.

## Data Flow
<pre>
User prompt
    → POST /api/ask {prompt, history, session_id}

    [Stage 0 — Intent Resolution (Python)]
    → extract_intent → resolve_defaults → preamble + intent_block

    [Stage 1 — Routing (Haiku)]
    → match_top_templates → top 6 + scores

    [Stage 2a — Template Execution (score ≥ 0.95)]
    → placeholders resolved → SQL executed → rows streamed
    → template plot code + Sonnet summary

    [Stage 2b — Tool-Loop Generation (Sonnet)]
    → system prompt = schema + sample data + intent_block (+ top 3 template hints)
    → per iteration: round + prompt + messages + tokens + tool_call + tool_result + response
    → last successful query → canonical sql + rows
    → Plot & Summary: separate Sonnet call (prefill + stop_seq for JSON) → plot config + summary + key_takeaways

    → SSE events:
       conversation_id, msg_id, user_prompt, preamble, intent,
       round, prompt, messages, token, tool_call, tool_result, response,
       sql, rows, plot_config, no_plot, template_plots, summary, key_takeaways,
       suggestions, distilled_summary, error

    → llm_logs saved per iteration with user + conversation_id
    → frontend: user bubble (right) + assistant bubble (left)
       assistant bubble: SQL collapsible, table, inline chart, one
       collapsible &lt;details&gt; per round (prompt / messages / response / tool_calls)
</pre>

## Persistence
- **SQLite** (`mediavision.db`): `llm_logs`, `conversations`, `users`, `evaluations`.
- `conversations` table: id, user, title, created_at — groups messages by session.
- `llm_logs`: each row has conversation_id + user for filtering.
- ID format: `conversation_id` and `msg_id` use server-generated timestamps `yyyy-mm-dd HH:mm:ss.nnnnnnnnn`.
- `result_data` on each llm_logs row stores the full assistant content dict (same shape the frontend assembles live from SSE events). `agent._collect()` taps every event and persists once at stream end so chat history renders identically via `ChatMessage` with zero re-derivation.

## Running
```bash
# backend (active)
cd backend && uv run uvicorn main:app --reload --port 8000

# frontend
cd frontend && npm run dev

# eval UI (port 5174)
cd eval-ui && npm run dev

# generate eval YAML files
cd backend && uv run python plot-eval.py --versions v1,v2 --limit 1
```

## Safety
- Read-only guard in `db.execute_query` blocks anything but `SELECT` / `WITH` plus dangerous keywords.
- Table names from information_schema only (not user input).
- Session cookies are HMAC-signed and expire in 7 days.
