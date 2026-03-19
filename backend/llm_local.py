import os
import json
import subprocess
import time
import httpx


LLAMA_SERVER_URL = os.getenv("LLAMA_SERVER_URL", "http://localhost:8081")
LLAMA_SERVER_BIN = os.getenv("LLAMA_SERVER_BIN", "llama-server")
LLAMA_MODEL = os.getenv("LLAMA_MODEL", "")

_process = None


def start_server():
	global _process
	if _process and _process.poll() is None:
		print("[llama] server already running")
		return
	if not LLAMA_MODEL:
		raise ValueError("LLAMA_MODEL not set in .env")
	cmd = f"{LLAMA_SERVER_BIN} --model {LLAMA_MODEL} --port 8081 --ctx-size 8192 --n-gpu-layers 99"
	print(f"[llama] starting: {cmd}")
	_process = subprocess.Popen(cmd, shell=True, stdout=None, stderr=None)
	for i in range(90):
		if _process.poll() is not None:
			raise RuntimeError(f"[llama] server exited with code {_process.returncode}")
		try:
			r = httpx.get(f"{LLAMA_SERVER_URL}/health", timeout=2)
			if r.status_code == 200:
				print(f"[llama] server ready ({i+1}s)")
				return
		except Exception:
			pass
		time.sleep(1)
	_process.terminate()
	raise RuntimeError("[llama] server failed to start within 90s")


def stop_server():
	global _process
	if _process and _process.poll() is None:
		print("[llama] stopping server")
		_process.terminate()
		_process.wait(timeout=5)
		_process = None


async def complete_stream(system_prompt, user_message):
	# yields text chunks, then a final {"__meta__": {...}} dict with usage info
	url = f"{LLAMA_SERVER_URL}/v1/chat/completions"
	payload = {
		"messages": [
			{"role": "system", "content": system_prompt},
			{"role": "user", "content": user_message},
		],
		"temperature": 0.1,
		"max_tokens": 2048,
		"stream": True,
	}
	meta = {}
	async with httpx.AsyncClient(timeout=120) as client:
		async with client.stream("POST", url, json=payload) as resp:
			resp.raise_for_status()
			async for line in resp.aiter_lines():
				if not line.startswith("data: "):
					continue
				data = line[6:]
				if data == "[DONE]":
					break
				try:
					chunk = json.loads(data)
					if chunk.get("model"):
						meta["model"] = chunk["model"]
					if chunk.get("usage"):
						meta["usage"] = chunk["usage"]
					text = chunk["choices"][0]["delta"].get("content", "")
					if text:
						yield text
				except Exception:
					pass
	yield {"__meta__": meta}


async def complete(system_prompt, user_message):
	url = f"{LLAMA_SERVER_URL}/v1/chat/completions"
	payload = {
		"messages": [
			{"role": "system", "content": system_prompt},
			{"role": "user", "content": user_message},
		],
		"temperature": 0.1,
		"max_tokens": 2048,
	}
	async with httpx.AsyncClient(timeout=120) as client:
		resp = await client.post(url, json=payload)
		resp.raise_for_status()
		return resp.json()
