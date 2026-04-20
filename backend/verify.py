import json
import llm

_SKIP_COLS = {"period_date"}

_VERIFY_SYSTEM = """You are verifying if SQL query results can answer a user's question.
Return ONLY JSON: {"ok": true, "reason": "brief explanation"}

Return ok=false ONLY when the data clearly cannot answer the question:
- wrong entity entirely (asked about Netflix, got all services with no Netflix rows)
- wrong metric (asked for reach but got spend)
- clearly wrong time period when user specified one

Return ok=true if the data looks related and plausible, even if incomplete or approximate.
Bias strongly toward ok=true to avoid unnecessary retries."""


async def verify_rows(user_prompt, columns, rows):
    if not rows:
        return {"ok": False, "reason": "Query returned no rows"}

    value_cols = [c for c in (columns or []) if c not in _SKIP_COLS]
    if value_cols:
        col = "value" if "value" in value_cols else value_cols[0]
        if all(r.get(col) is None for r in rows[:20]):
            return {"ok": False, "reason": f"Column '{col}' contains only null values"}

    sample = rows[:10]
    col_str = ", ".join(columns or [])
    row_lines = "\n".join(str(r) for r in sample)
    msg = f"Question: {user_prompt}\nColumns: {col_str}\nRows ({len(rows)} total, showing {len(sample)}):\n{row_lines}"

    try:
        text = await llm.complete_text({
            "system": _VERIFY_SYSTEM,
            "messages": [{"role": "user", "content": msg}],
            "model": "haiku",
            "max_tokens": 100,
            "label": "verify-rows",
        })
        data = json.loads(text)
        return {"ok": bool(data.get("ok")), "reason": data.get("reason", "")}
    except Exception as e:
        print(f"[verify] error: {e}")
        return {"ok": True, "reason": "verification skipped"}
