import os
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from db import create_pool, close_pool, execute_query
from skills import generate_skills, load_skills
from agent import generate_sql


@asynccontextmanager
async def lifespan(app):
	await create_pool()
	await generate_skills()
	print("[startup] database connected, skills generated")
	yield
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


@app.get("/api/health")
async def health():
	return {"status": "ok"}


@app.get("/api/skills")
async def skills():
	data = load_skills()
	return data


@app.post("/api/query")
async def query(req: QueryRequest):
	try:
		result = await generate_sql(req.prompt, req.backend)
		sql = result["sql"]
		explanation = result["explanation"]
	except Exception as e:
		return {"error": f"LLM error: {str(e)}", "sql": None, "columns": [], "rows": []}

	try:
		sql_with_path = f"SET search_path TO macro, public; {sql}"
		data = await execute_query(sql_with_path)
	except Exception as e:
		return {"error": f"SQL error: {str(e)}", "sql": sql, "explanation": explanation, "columns": [], "rows": []}

	return {
		"sql": sql,
		"explanation": explanation,
		"columns": data["columns"],
		"rows": data["rows"],
	}
