import os
import glob
import json
import hashlib
import hmac
import time
import yaml
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from db import create_pool, close_pool, execute_query
from template_filters import detect_placeholders, build_default_filters, apply_filters
from agent import generate_agent_stream
from data_examples import load_dimension_to_kpi
from intent import set_dimension_to_kpi
import evaldb


@asynccontextmanager
async def lifespan(app):
	await create_pool()
	print("[startup] database connected")
	mapping = await load_dimension_to_kpi()
	set_dimension_to_kpi(mapping)
	yield
	await close_pool()


app = FastAPI(lifespan=lifespan)

SESSION_SECRET  = os.getenv("SESSION_SECRET", "mv-default-secret-change-me")
SESSION_MAX_AGE = 7 * 24 * 3600  # 7 days

app.add_middleware(
	CORSMiddleware,
	allow_origins=["http://localhost:5173"],
	allow_methods=["*"],
	allow_headers=["*"],
	allow_credentials=True,
)


def make_session_token(username):
	expires = int(time.time()) + SESSION_MAX_AGE
	payload = f"{username}:{expires}"
	sig = hmac.new(SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
	return f"{payload}:{sig}"


def verify_session_token(token):
	if not token:
		return None
	try:
		parts = token.split(":")
		if len(parts) != 3:
			return None
		username, expires_str, sig = parts
		payload = f"{username}:{expires_str}"
		expected = hmac.new(SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
		if not hmac.compare_digest(sig, expected):
			return None
		if int(expires_str) < int(time.time()):
			return None
		return username
	except Exception:
		return None


def get_current_user(request: Request):
	token = request.cookies.get("mv_session")
	return verify_session_token(token)


PUBLIC_PATHS = {"/api/login", "/api/health", "/api/me"}


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
	path = request.url.path
	if path.startswith("/api/") and path not in PUBLIC_PATHS:
		username = get_current_user(request)
		if username:
			return await call_next(request)
		else:
			return JSONResponse({"error": "Not authenticated"}, status_code=401)
	return await call_next(request)


class AskRequest(BaseModel):
	prompt:     str  = Field(..., max_length=4000)
	history:    list = Field(default=[], max_length=50)
	session_id: str  = Field("", max_length=64)


class SqlRequest(BaseModel):
	sql: str = Field(..., max_length=4000)


class LoginRequest(BaseModel):
	username: str
	password: str


class ConversationRequest(BaseModel):
	id:    str = Field(..., max_length=64)
	title: str = Field("", max_length=200)


@app.get("/api/health")
async def health():
	return {"status": "ok"}


@app.get("/api/me")
async def me(request: Request):
	username = get_current_user(request)
	if username:
		return {"ok": True, "username": username}
	else:
		return {"ok": False}


_login_attempts = {}  # ip -> (count, first_attempt_time)
LOGIN_RATE_WINDOW = 300
LOGIN_RATE_LIMIT  = 10


@app.post("/api/login")
async def login(req: LoginRequest, request: Request):
	ip = request.client.host if request.client else "unknown"
	now = time.time()
	count, first_time = _login_attempts.get(ip, (0, now))
	if now - first_time > LOGIN_RATE_WINDOW:
		count, first_time = 0, now
	if count >= LOGIN_RATE_LIMIT:
		return JSONResponse({"ok": False, "error": "Too many login attempts, try again later"}, status_code=429)

	if not req.username or len(req.username) > 64 or not req.username.isalnum():
		_login_attempts[ip] = (count + 1, first_time)
		return {"ok": False, "error": "Invalid username or password"}

	if evaldb.verify_user(req.username, req.password):
		_login_attempts.pop(ip, None)
		token = make_session_token(req.username)
		resp = JSONResponse({"ok": True, "username": req.username})
		is_secure = str(request.url).startswith("https")
		resp.set_cookie("mv_session", token, max_age=SESSION_MAX_AGE, httponly=True, samesite="lax", secure=is_secure)
		return resp
	else:
		_login_attempts[ip] = (count + 1, first_time)
		return {"ok": False, "error": "Invalid username or password"}


@app.post("/api/sql")
async def run_sql(req: SqlRequest):
	try:
		data = await execute_query(req.sql)
	except Exception as e:
		return {"error": f"SQL error: {str(e)}", "sql": req.sql, "columns": [], "rows": []}
	return {
		"sql":     req.sql,
		"columns": data["columns"],
		"rows":    data["rows"],
	}


@app.post("/api/conversations")
async def create_conversation(req: ConversationRequest, request: Request):
	username = get_current_user(request)
	evaldb.save_conversation(req.id, username, req.title)
	return {"ok": True}


@app.get("/api/conversations")
async def list_conversations(request: Request):
	username = get_current_user(request)
	return {"conversations": evaldb.get_conversations(username)}


@app.get("/api/conversations/{conv_id}")
async def get_conversation(conv_id: str):
	messages = evaldb.get_conversation_messages(conv_id)
	return {"messages": messages}


TEMPLATE_DIR = os.path.join(os.path.dirname(__file__), "template")


def _safe_yaml_path(name):
	if "\\" in name or ".." in name.split("/"):
		return None
	path = os.path.join(TEMPLATE_DIR, name)
	real = os.path.realpath(path)
	if real.startswith(os.path.realpath(TEMPLATE_DIR) + os.sep):
		return path
	else:
		return None


@app.get("/api/templates")
async def list_templates():
	result = []
	for path in sorted(glob.glob(os.path.join(TEMPLATE_DIR, "**", "*.yaml"), recursive=True)):
		rel = os.path.relpath(path, TEMPLATE_DIR)
		with open(path) as f:
			data = yaml.safe_load(f)
		folder = os.path.dirname(rel)
		category = folder if folder else data.get("category", "")
		result.append({
			"name":        rel[:-5],  # strip .yaml
			"category":    category,
			"description": data.get("description", ""),
			"status":      data.get("status", ""),
		})
	return {"templates": result}


@app.get("/api/templates/{name:path}")
async def run_template(name: str):
	fname = name if name.endswith(".yaml") else name + ".yaml"
	path = _safe_yaml_path(fname)
	if path and os.path.exists(path):
		with open(path) as f:
			data = yaml.safe_load(f)
		sql = data.get("sql", "")
		plots = data.get("plots", [])
		placeholders = detect_placeholders(sql)
		if placeholders:
			yaml_filters = data.get("filters")
			defaults = await build_default_filters(placeholders, yaml_filters)
			sql = apply_filters(sql, defaults)
		try:
			result = await execute_query(sql)
		except Exception as e:
			return {"error": str(e), "sql": sql, "columns": [], "rows": [], "plots": plots}
		return {
			"name":        name,
			"description": data.get("description", ""),
			"sql":         sql,
			"columns":     result["columns"],
			"rows":        result["rows"],
			"plots":       plots,
		}
	else:
		return JSONResponse({"error": "not found"}, status_code=404)


@app.post("/api/ask")
async def ask(req: AskRequest, request: Request):
	username = get_current_user(request)
	async def stream():
		try:
			async for event in generate_agent_stream(
				req.prompt, req.history,
				user=username or "", conversation_id=req.session_id
			):
				yield f"data: {json.dumps(event)}\n\n"
		except Exception as e:
			yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
	return StreamingResponse(stream(), media_type="text/event-stream")
