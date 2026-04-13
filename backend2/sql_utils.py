import re


def extract_sql(text):
    match = re.search(r"```sql\s*(.*?)\s*```", text, re.DOTALL)
    if match:
        return match.group(1).strip()
    match = re.search(r"(SELECT\s+.+?;)", text, re.DOTALL | re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return None


def extract_sqls(text):
    # returns all sql blocks in order (primary first, then alternatives)
    return [m.strip() for m in re.findall(r"```sql\s*(.*?)\s*```", text, re.DOTALL)]


def _remove_empty_string_filters(sql):
    cols = ['age_group', 'population_segment', 'kpi_dimension']
    result = sql
    for col in cols:
        empty = r"""(?:'{2}|"{2})"""
        cond  = rf"""{col}\s*=\s*{empty}"""
        result = re.sub(rf'\n[ \t]*AND[ \t]+{cond}[ \t]*', '', result, flags=re.IGNORECASE)
        result = re.sub(rf'[ \t]*{cond}[ \t]+AND[ \t]*\n?', '', result, flags=re.IGNORECASE)
        result = re.sub(rf'[ \t]*{cond}[ \t]*', '', result, flags=re.IGNORECASE)
    result = re.sub(r'\bWHERE\s*(?=GROUP\b|ORDER\b|LIMIT\b)', '', result, flags=re.IGNORECASE)
    result = re.sub(r'\n[ \t]*\n', '\n', result)
    return result.strip()


def _fix_incomplete_is_null_or(sql):
    result = re.sub(
        r'\(\s*(\w+)\s+IS\s+NULL\s+OR\s*\)',
        r"(\1 IS NULL OR \1 = '')",
        sql,
        flags=re.IGNORECASE,
    )
    result = re.sub(
        r'\(\s*(\w+)\.(\w+)\s+IS\s+NULL\s+OR\s+\1\.\s*\)',
        r"(\1.\2 IS NULL OR \1.\2 = '')",
        result,
        flags=re.IGNORECASE,
    )
    return result


_POST_PROCESSORS = [
    ("remove_empty_string_filters", _remove_empty_string_filters),
    ("fix_incomplete_is_null_or", _fix_incomplete_is_null_or),
]


def postprocess_sql(sql):
    result = sql
    for name, fn in _POST_PROCESSORS:
        before = result
        result = fn(result)
        if result != before:
            print(f"[postprocess] {name} changed sql")
    return result


def build_messages(history, prompt):
    messages = []
    for h in history:
        messages.append({"role": h["role"], "content": h["text"]})
    messages.append({"role": "user", "content": prompt})
    return messages
