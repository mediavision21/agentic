#!/usr/bin/env python3
# CLI for querying the database via LLM
# Usage: python cli.py "show all countries" [--backend local|claude]
import os
import sys
import asyncio

sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from db import create_pool, close_pool, execute_query
from agent import generate_sql
from skills import generate_skills
import llm_local


async def main():
	args = sys.argv[1:]
	backend = os.getenv("LLM_BACKEND", "claude")
	prompt = None

	# parse args
	i = 0
	while i < len(args):
		if args[i] == "--backend" and i + 1 < len(args):
			backend = args[i + 1]
			i += 2
		else:
			prompt = args[i]
			i += 1

	if not prompt:
		print("Usage: python cli.py \"your question\" [--backend local|claude]")
		sys.exit(1)

	# start llama server if needed
	if backend == "local":
		llm_local.start_server()

	try:
		await create_pool()
		await generate_skills()

		print(f"[cli] backend={backend}")
		print(f"[cli] prompt: {prompt}")
		print()

		result = await generate_sql(prompt, backend)
		sql = result["sql"]
		explanation = result["explanation"]

		print(f"SQL:\n{sql}\n")
		print(f"Explanation: {explanation}\n")

		data = await execute_query(sql)
		if data["rows"]:
			# print columns
			cols = data["columns"]
			print("\t".join(cols))
			print("\t".join("-" * len(c) for c in cols))
			for row in data["rows"]:
				print("\t".join(str(row.get(c, "")) for c in cols))
			print(f"\n({len(data['rows'])} rows)")
		else:
			print("(no rows)")

	finally:
		await close_pool()
		if backend == "local":
			llm_local.stop_server()


if __name__ == "__main__":
	asyncio.run(main())
