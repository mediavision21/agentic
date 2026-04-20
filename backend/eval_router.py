import os
import re
import json
import asyncio
import base64
from pathlib import Path
from fastapi import APIRouter
from fastapi.responses import JSONResponse

EVAL_OUTPUT = Path(__file__).parent.parent / "eval-output"
RENDER_SCRIPT = Path(__file__).parent.parent / "eval" / "render_plot.mjs"

router = APIRouter(prefix="/eval")


async def _render_svg(config, rows):
	payload = json.dumps({"config": config, "rows": rows[:50]}, default=str)
	proc = await asyncio.create_subprocess_exec(
		"node", str(RENDER_SCRIPT),
		stdin=asyncio.subprocess.PIPE,
		stdout=asyncio.subprocess.PIPE,
		stderr=asyncio.subprocess.PIPE,
	)
	stdout, stderr = await proc.communicate(payload.encode())
	if proc.returncode != 0:
		return None, stderr.decode().strip()
	return stdout.decode(), None


@router.get("/files")
async def list_files():
	if not EVAL_OUTPUT.exists():
		return []
	files = sorted(EVAL_OUTPUT.glob("*.yaml"), key=lambda f: f.stat().st_mtime, reverse=True)
	return [f.name for f in files]


@router.get("/files/{name}")
async def get_file(name: str):
	if not name.endswith(".yaml") or "/" in name or ".." in name:
		return JSONResponse({"error": "invalid"}, status_code=400)
	path = EVAL_OUTPUT / name
	if not path.exists():
		return JSONResponse({"error": "not found"}, status_code=404)
	import yaml
	data = yaml.safe_load(path.read_text())
	return JSONResponse(data)


@router.post("/render")
async def render_endpoint(body: dict):
	svg, err = await _render_svg(body.get("config"), body.get("rows", []))
	if err:
		return JSONResponse({"error": err}, status_code=400)
	return {"svg": svg}


@router.post("/score")
async def score_endpoint(body: dict):
	config = body.get("config")
	rows = body.get("rows", [])
	description = body.get("description", "")

	svg, err = await _render_svg(config, rows)
	if err:
		return JSONResponse({"error": f"render: {err}"}, status_code=400)

	try:
		import cairosvg
		png_bytes = cairosvg.svg2png(bytestring=svg.encode())
		png_b64 = base64.b64encode(png_bytes).decode()
	except ImportError:
		return JSONResponse({"error": "cairosvg not installed — run: uv add cairosvg"}, status_code=500)

	import anthropic
	client = anthropic.AsyncAnthropic(api_key=os.getenv("API_KEY"))
	msg = await client.messages.create(
		model="claude-sonnet-4-6",
		max_tokens=512,
		system="You are a data visualization expert. Evaluate charts for clarity, appropriate mark selection, and data representation accuracy.",
		messages=[{
			"role": "user",
			"content": [
				{
					"type": "image",
					"source": {"type": "base64", "media_type": "image/png", "data": png_b64},
				},
				{
					"type": "text",
					"text": f"Chart description: {description}\n\nScore this chart 1-10 for data visualization quality. Return JSON only: {{\"score\": N, \"reasoning\": \"...\"}}",
				},
			],
		}],
	)
	text = msg.content[0].text
	print(f"[eval/score] {text[:120]}")
	match = re.search(r'\{.*?\}', text, re.DOTALL)
	if match:
		try:
			return json.loads(match.group())
		except Exception:
			pass
	return {"score": None, "reasoning": text}
