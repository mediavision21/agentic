import os
import json
import sqlite3
import hashlib
import secrets
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "mediavision.db")


def _conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _hash_password(password, salt=None):
    if salt is None:
        salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100000)
    return f"{salt}:{dk.hex()}"


def _verify_password(password, stored):
    salt = stored.split(":")[0]
    return _hash_password(password, salt) == stored


def init_db():
    conn = _conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS llm_logs (
            id TEXT PRIMARY KEY,
            timestamp TEXT,
            prompt TEXT,
            system_prompt TEXT,
            messages TEXT,
            response TEXT,
            model TEXT,
            usage TEXT
        );
        CREATE TABLE IF NOT EXISTS evaluations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            log_id TEXT,
            rating TEXT,
            user TEXT,
            comment TEXT,
            timestamp TEXT
        );
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT
        );
    """)
    # migrate: add user and comment columns if missing
    try:
        conn.execute("ALTER TABLE evaluations ADD COLUMN user TEXT DEFAULT ''")
    except Exception:
        pass
    try:
        conn.execute("ALTER TABLE evaluations ADD COLUMN comment TEXT DEFAULT ''")
    except Exception:
        pass
    conn.commit()
    conn.close()


def create_user(username, password):
    conn = _conn()
    try:
        conn.execute(
            "INSERT INTO users (username, password_hash, created_at) VALUES (?,?,?)",
            (username, _hash_password(password), datetime.now().isoformat())
        )
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()


def verify_user(username, password):
    conn = _conn()
    row = conn.execute("SELECT password_hash FROM users WHERE username=?", (username,)).fetchone()
    conn.close()
    if not row:
        return False
    return _verify_password(password, row["password_hash"])


def save_log(id, prompt, system_prompt, messages, response, model, usage):
    conn = _conn()
    conn.execute(
        "INSERT OR REPLACE INTO llm_logs VALUES (?,?,?,?,?,?,?,?)",
        (id, datetime.now().isoformat(), prompt, system_prompt,
         json.dumps(messages), response, model, json.dumps(usage))
    )
    conn.commit()
    conn.close()


def save_evaluation(log_id, rating, user="", comment=""):
    conn = _conn()
    conn.execute(
        "INSERT INTO evaluations (log_id, rating, user, comment, timestamp) VALUES (?,?,?,?,?)",
        (log_id, rating, user, comment, datetime.now().isoformat())
    )
    conn.commit()
    conn.close()


def get_evaluations():
    conn = _conn()
    rows = conn.execute("""
        SELECT e.id, e.log_id, e.rating, e.user, e.comment, e.timestamp,
               l.prompt, l.response
        FROM evaluations e
        LEFT JOIN llm_logs l ON e.log_id = l.id
        ORDER BY e.timestamp DESC
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]


init_db()
