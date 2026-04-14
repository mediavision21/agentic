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
			usage TEXT,
			user TEXT DEFAULT '',
			conversation_id TEXT DEFAULT '',
			result_data TEXT DEFAULT ''
		);
		CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			created_at TEXT
		);
		CREATE TABLE IF NOT EXISTS conversations (
			id TEXT PRIMARY KEY,
			user TEXT,
			title TEXT,
			created_at TEXT
		);
		CREATE TABLE IF NOT EXISTS evaluations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			log_id TEXT,
			rating TEXT,
			user TEXT,
			comment TEXT,
			timestamp TEXT
		);
	""")
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
	if row:
		return _verify_password(password, row["password_hash"])
	else:
		return False


def save_log(id, prompt, system_prompt, messages, response, model, usage, user="", conversation_id="", result_data=""):
	conn = _conn()
	conn.execute(
		"INSERT OR REPLACE INTO llm_logs (id, timestamp, prompt, system_prompt, messages, response, model, usage, user, conversation_id, result_data) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
		(id, datetime.now().isoformat(), prompt, system_prompt,
		 json.dumps(messages), response, model, json.dumps(usage), user, conversation_id,
		 json.dumps(result_data) if isinstance(result_data, dict) else result_data)
	)
	conn.commit()
	conn.close()


def get_result_data(log_id):
	conn = _conn()
	row = conn.execute("SELECT result_data FROM llm_logs WHERE id=?", (log_id,)).fetchone()
	conn.close()
	if row and row["result_data"]:
		try:
			return json.loads(row["result_data"])
		except Exception:
			return {}
	return {}


def update_result_data(log_id, result_data):
	conn = _conn()
	conn.execute(
		"UPDATE llm_logs SET result_data=? WHERE id=?",
		(json.dumps(result_data) if isinstance(result_data, dict) else result_data, log_id)
	)
	conn.commit()
	conn.close()


def save_conversation(id, user, title):
	conn = _conn()
	conn.execute(
		"INSERT OR IGNORE INTO conversations (id, user, title, created_at) VALUES (?,?,?,?)",
		(id, user, title, datetime.now().isoformat())
	)
	conn.commit()
	conn.close()


def update_conversation_title(id, title):
	conn = _conn()
	conn.execute("UPDATE conversations SET title=? WHERE id=?", (title, id))
	conn.commit()
	conn.close()


def get_conversations(user):
	conn = _conn()
	rows = conn.execute(
		"SELECT id, user, title, created_at FROM conversations WHERE user=? ORDER BY created_at DESC",
		(user,)
	).fetchall()
	conn.close()
	return [dict(r) for r in rows]


def get_all_conversations_by_user():
	conn = _conn()
	rows = conn.execute(
		"SELECT id, user, title, created_at FROM conversations ORDER BY user ASC, created_at DESC"
	).fetchall()
	conn.close()
	# group by user
	groups = {}
	for r in rows:
		d = dict(r)
		u = d["user"] or ""
		if u not in groups:
			groups[u] = []
		groups[u].append(d)
	return [{"user": u, "conversations": convs} for u, convs in groups.items()]


def get_conversation_messages(conversation_id):
	conn = _conn()
	rows = conn.execute(
		"SELECT id, prompt, response, result_data, timestamp FROM llm_logs WHERE conversation_id=? ORDER BY timestamp ASC",
		(conversation_id,)
	).fetchall()
	conn.close()
	return [dict(r) for r in rows]


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
	rows = conn.execute("SELECT * FROM evaluations ORDER BY timestamp DESC").fetchall()
	conn.close()
	return [dict(r) for r in rows]


def get_evaluated_sessions():
	conn = _conn()
	rows = conn.execute("""
		SELECT c.id, c.user, c.title, c.created_at, COUNT(e.id) AS eval_count
		FROM conversations c
		JOIN llm_logs l ON l.conversation_id = c.id
		JOIN evaluations e ON e.log_id = l.id
		GROUP BY c.id
		ORDER BY c.created_at DESC
	""").fetchall()
	conn.close()
	return [dict(r) for r in rows]


def get_conversation_evaluations(conversation_id):
	conn = _conn()
	rows = conn.execute("""
		SELECT e.*
		FROM evaluations e
		JOIN llm_logs l ON l.id = e.log_id
		WHERE l.conversation_id = ?
		ORDER BY e.timestamp ASC
	""", (conversation_id,)).fetchall()
	conn.close()
	return [dict(r) for r in rows]


init_db()
