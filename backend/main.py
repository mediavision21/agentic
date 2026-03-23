import os
import json
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from db import create_pool, close_pool, execute_query
from skills import generate_skills, load_skills
from agent import generate_agent_stream
import llm_local
import evaldb

SKILL_TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "skill_templates")


@asynccontextmanager
async def lifespan(app):
	await create_pool()
	await generate_skills()
	if os.getenv("LLM_BACKEND") == "local" and os.getenv("START_LLAMA", "1") != "0":
		llm_local.start_server()
	print("[startup] database connected, skills generated")
	yield
	if os.getenv("START_LLAMA", "1") != "0":
		llm_local.stop_server()
	await close_pool()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
	CORSMiddleware,
	allow_origins=["http://localhost:5173"],
	allow_methods=["*"],
	allow_headers=["*"],
)


class QueryRequest(BaseModel):
	prompt: str
	backend: str = "claude"
	history: list = []


class SqlRequest(BaseModel):
	sql: str


class EvalRequest(BaseModel):
	msg_id: str
	rating: str
	user: str = ""
	comment: str = ""


class LoginRequest(BaseModel):
	username: str
	password: str


class SkillTemplateUpdate(BaseModel):
	content: str


@app.get("/api/health")
async def health():
	return {"status": "ok"}


@app.post("/api/login")
async def login(req: LoginRequest):
	if evaldb.verify_user(req.username, req.password):
		return {"ok": True, "username": req.username}
	return {"ok": False, "error": "Invalid username or password"}


@app.post("/api/create-pivot")
async def create_pivot():
	from create_pivot import main as run_pivot
	try:
		# await run_pivot()
		await generate_skills()
		return {"ok": True}
	except Exception as e:
		return {"error": str(e)}


@app.get("/api/skills")
async def skills():
	data = load_skills()
	return data


@app.post("/api/sql")
async def run_sql(req: SqlRequest):
	try:
		data = await execute_query(req.sql)
	except Exception as e:
		return {"error": f"SQL error: {str(e)}", "sql": req.sql, "columns": [], "rows": []}
	return {
		"sql": req.sql,
		"columns": data["columns"],
		"rows": data["rows"],
	}


@app.post("/api/evaluate")
async def evaluate(req: EvalRequest):
	evaldb.save_evaluation(req.msg_id, req.rating, req.user, req.comment)
	return {"ok": True}


@app.get("/api/evaluations")
async def list_evaluations():
	data = evaldb.get_evaluations()
	return {"evaluations": data}


@app.get("/api/skill-templates")
async def list_skill_templates():
	files = sorted(f for f in os.listdir(SKILL_TEMPLATES_DIR) if f.endswith(".md"))
	return {"files": files}


@app.get("/api/skill-templates/{name}")
async def get_skill_template(name: str):
	path = os.path.join(SKILL_TEMPLATES_DIR, name)
	if not os.path.exists(path):
		return {"error": "not found"}
	with open(path) as f:
		return {"name": name, "content": f.read()}


@app.put("/api/skill-templates/{name}")
async def update_skill_template(name: str, req: SkillTemplateUpdate):
	path = os.path.join(SKILL_TEMPLATES_DIR, name)
	with open(path, "w") as f:
		f.write(req.content)
	return {"ok": True}


@app.post("/api/query")
async def query(req: QueryRequest):
	async def stream():
		try:
			async for event in generate_agent_stream(req.prompt, req.backend, req.history):
				yield f"data: {json.dumps(event)}\n\n"
		except Exception as e:
			yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
	return StreamingResponse(stream(), media_type="text/event-stream")
