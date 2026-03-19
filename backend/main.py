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
from agent import generate_sql_stream
import llm_local


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


class SqlRequest(BaseModel):
	sql: str


@app.get("/api/health")
async def health():
	return {"status": "ok"}


@app.post("/api/create-pivot")
async def create_pivot():
	from create_pivot import main as run_pivot
	try:
		await run_pivot()
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


@app.post("/api/query")
async def query(req: QueryRequest):
	async def stream():
		try:
			async for event in generate_sql_stream(req.prompt, req.backend):
				yield f"data: {json.dumps(event)}\n\n"
		except Exception as e:
			yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
	return StreamingResponse(stream(), media_type="text/event-stream")
