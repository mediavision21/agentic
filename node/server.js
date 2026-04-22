import http from 'node:http'
import { join } from 'node:path'
import { createServer as createViteServer } from 'vite'
import { initDb } from './sqlite.js'
import { initPool } from './db.js'
import { loadDimensionToKpi } from './data_examples.js'
import { dispatch } from './router.js'

const PORT = process.env.PORT || 8001

async function readBody(req) {
	const chunks = []
	for await (const chunk of req) chunks.push(chunk)
	try {
		return JSON.parse(Buffer.concat(chunks).toString())
	} catch (_) {
		return {}
	}
}

async function main() {
	// 1. init SQLite (sync)
	initDb()

	// 2. connect PostgreSQL pool
	await initPool()

	// 3. load dimension-to-kpi mapping (warms cache)
	await loadDimensionToKpi()

	// 4. create Vite dev server in middleware mode
	const vite = await createViteServer({
		configFile: join(import.meta.dirname, '..', 'frontend', 'vite.config.js'),
		root: join(import.meta.dirname, '..', 'frontend'),
		server: { middlewareMode: true },
		appType: 'spa',
		optimizeDeps: { exclude: ['@rock/sqlite'] },
	})

	// 5. create http server
	const server = http.createServer(async (req, res) => {
		const pathname = new URL(req.url, 'http://localhost').pathname

		if (pathname.startsWith('/api/') || pathname.startsWith('/eval/')) {
			let body = {}
			if (req.method === 'POST' || req.method === 'PUT') {
				body = await readBody(req)
			}
			const handled = await dispatch(req, res, body, pathname)
			if (!handled) {
				res.writeHead(404, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ error: 'not found' }))
			}
		} else {
			vite.middlewares(req, res, () => {
				res.writeHead(404)
				res.end('Not found')
			})
		}
	})

	server.listen(PORT, () => {
		console.log(`[server] listening on http://localhost:${PORT}`)
	})

	process.on('SIGTERM', async () => {
		server.close()
		await vite.close()
	})
}

main().catch(err => {
	console.error('[startup] fatal:', err)
	process.exit(1)
})
