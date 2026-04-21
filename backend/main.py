import os
import re
import glob
import json
import hashlib
import hmac
import time
import yaml
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

import env  # noqa: F401

from db import create_pool, close_pool, execute_query
from template_filters import detect_placeholders, build_default_filters, apply_filters
from agent import generate_agent_stream
from data_examples import load_dimension_to_kpi
from intent import set_dimension_to_kpi
import evaldb
from eval_router import router as eval_router


@asynccontextmanager
async def lifespan(app):
	await create_pool()
	print("[startup] database connected")
	mapping = await load_dimension_to_kpi()
	set_dimension_to_kpi(mapping)
	yield
	await close_pool()


app = FastAPI(lifespan=lifespan)
app.include_router(eval_router)

SESSION_SECRET  = os.getenv("SESSION_SECRET", "mv-default-secret-change-me")
SESSION_MAX_AGE = 7 * 24 * 3600  # 7 days

app.add_middleware(
	CORSMiddleware,
	allow_origins=["http://localhost:5173", "http://localhost:5174"],
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


class EvalRequest(BaseModel):
	msg_id:  str = Field(..., max_length=64)
	rating:  str = Field(..., pattern=r"^(good|bad)$")
	user:    str = Field("", max_length=64)
	comment: str = Field("", max_length=2000)


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
async def get_conversation(conv_id: str, request: Request):
	username = get_current_user(request)
	messages = evaldb.get_conversation_messages(conv_id, user=username)
	return {"messages": messages}


ADMIN_USER = "rockie"


@app.get("/api/admin/conversations")
async def admin_conversations(request: Request):
	username = get_current_user(request)
	if username != ADMIN_USER:
		return JSONResponse({"error": "Forbidden"}, status_code=403)
	return {"groups": evaldb.get_all_conversations_by_user()}


def _literal_str(s):
	class _Lit(str): pass
	def _representer(dumper, data):
		return dumper.represent_scalar("tag:yaml.org,2002:str", data, style="|")
	yaml.add_representer(_Lit, _representer)
	return _Lit(s)


def _plot_config_to_js(config):
	"""Convert plot_config JSON to Observable Plot JS code compatible with TemplatePanel."""
	if not config or not config.get("marks"):
		return None
	marks = config["marks"]
	x_cfg   = config.get("x", {})
	y_cfg   = config.get("y", {})
	col_cfg = config.get("color", {})
	fx_cfg  = config.get("fx")

	y_col = marks[0].get("y", "value") if marks else "value"

	# detect whether any mark uses period_label as a color dimension
	color_col = next((m.get("fill") or m.get("stroke") for m in marks if m.get("fill") or m.get("stroke")), None)
	needs_period_sort = color_col == "period_label"

	lines = [
		"var rows = data.map(function(d) {",
		f"    return Object.assign({{}}, d, {{ {y_col}: +d.{y_col} }});",
		"});",
	]

	if needs_period_sort:
		lines += [
			"// sort period_label domain chronologically via period_sort",
			"var _periodOrder = [];",
			"var _seenP = {};",
			"data.slice().sort(function(a, b) { return +a.period_sort - +b.period_sort; }).forEach(function(d) {",
			"    if (!_seenP[d.period_label]) { _seenP[d.period_label] = true; _periodOrder.push(d.period_label); }",
			"});",
		]

	MARK_FN = {"lineY": "Plot.lineY", "barY": "Plot.barY", "dot": "Plot.dot", "areaY": "Plot.areaY"}
	mark_lines = []
	for m in marks:
		fn = MARK_FN.get(m.get("type", "lineY"), "Plot.lineY")
		opts = {k: m[k] for k in ("x", "y", "stroke", "fill", "fx", "curve") if m.get(k) is not None}
		if m.get("type") == "lineY" and "curve" not in opts:
			opts["curve"] = "catmull-rom"
		opts_js = ", ".join(f'"{k}": "{v}"' for k, v in opts.items())
		mark_lines.append(f"    {fn}(rows, {{ {opts_js} }})")
		if m.get("type") == "lineY":
			stroke = m.get("stroke") or m.get("fill")
			dot_js = f'"x": "{m["x"]}", "y": "{m["y"]}"'
			if stroke:
				dot_js += f', "fill": "{stroke}"'
			dot_js += ', "r": 3'
			mark_lines.append(f"    Plot.dot(rows, {{ {dot_js} }})")
		if m.get("type") == "barY":
			mark_lines.append("    Plot.ruleY([0])")

	def _obj(d):
		return "{ " + ", ".join(f'"{k}": {json.dumps(v)}' for k, v in d.items()) + " }"

	color_expr = "{ \"legend\": true"
	if needs_period_sort:
		color_expr += ", domain: _periodOrder"
	elif col_cfg:
		for k, v in col_cfg.items():
			if k != "legend":
				color_expr += f', "{k}": {json.dumps(v)}'
	color_expr += " }"

	plot_parts = [
		"    marks: [\n" + ",\n".join(mark_lines) + "\n    ]",
	]
	if x_cfg:
		plot_parts.append(f"    x: {{ {', '.join(f'{json.dumps(k)}: {json.dumps(v)}' for k, v in x_cfg.items())} }}")
	if y_cfg:
		plot_parts.append(f"    y: {{ {', '.join(f'{json.dumps(k)}: {json.dumps(v)}' for k, v in y_cfg.items())} }}")
	plot_parts.append(f"    color: {color_expr}")
	if fx_cfg:
		plot_parts.append(f"    fx: {_obj(fx_cfg) if isinstance(fx_cfg, dict) else json.dumps(fx_cfg)}")

	lines.append("return Plot.plot({")
	lines.append(",\n".join(f"    {p}" if not p.startswith("    ") else p for p in plot_parts) + ",")
	lines.append("});")
	return "\n".join(lines)


@app.post("/api/evaluate")
async def evaluate(req: EvalRequest, request: Request):
	username = get_current_user(request)
	evaldb.save_evaluation(req.msg_id, req.rating, username or req.user, req.comment)
	if req.rating == "good":
		rd = evaldb.get_result_data(req.msg_id)
		sql = rd.get("sql", "")
		if sql:
			desc = req.comment or rd.get("user_prompt", req.msg_id)
			safe_name = re.sub(r"[^a-zA-Z0-9_\-\s]", "_", desc.strip())[:60].strip().replace(" ", "_").lower()
			if not safe_name:
				safe_name = re.sub(r"[^a-zA-Z0-9_\-]", "_", req.msg_id)
			tpl = {"description": desc, "sql": _literal_str(sql)}
			template_plots = rd.get("template_plots")
			plot_config    = rd.get("plot_config")
			if template_plots:
				def _wrap_plot(p):
					out = {**p}
					if "config" in out and isinstance(out["config"], str):
						out["config"] = _literal_str(out["config"])
					return out
				tpl["plots"] = [_wrap_plot(p) for p in template_plots]
			else:
				js = _plot_config_to_js(plot_config)
				if js:
					tpl["plots"] = [{"id": "chart", "title": desc[:80], "code": _literal_str(js)}]
			path = os.path.join(EVAL_TEMPLATE_DIR, safe_name + ".yaml")
			with open(path, "w") as f:
				yaml.dump(tpl, f, allow_unicode=True, default_flow_style=False, sort_keys=False)
			print(f"[evaluate] saved template {path}")
	return {"ok": True}


@app.get("/api/evaluations")
async def list_evaluations():
	return {"evaluations": evaldb.get_evaluations()}


@app.get("/api/evaluated-sessions")
async def list_evaluated_sessions():
	return {"sessions": evaldb.get_evaluated_sessions()}


@app.get("/api/conversations/{conv_id}/evaluations")
async def get_conversation_evals(conv_id: str):
	return {"evaluations": evaldb.get_conversation_evaluations(conv_id)}


TEMPLATE_DIR = os.path.join(os.path.dirname(__file__), "template")
EVAL_TEMPLATE_DIR = os.path.join(TEMPLATE_DIR, "evaluations")
os.makedirs(EVAL_TEMPLATE_DIR, exist_ok=True)


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
