import http from 'node:http'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dispatch } from './router.js'

const PORT = process.env.PORT || 8001
const DEV = process.env.NODE_ENV !== 'production'
const DIST = '/opt/rock/frontend/dist'

async function readBody(req) {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    try {
        return JSON.parse(Buffer.concat(chunks).toString())
    } catch (_) {
        return {}
    }
}

// serve static file from dist, fallback to index.html for SPA routing
async function serveStatic(req, res) {
    const pathname = new URL(req.url, 'http://localhost').pathname
    const filePath = join(DIST, pathname)
    if (existsSync(filePath) && !filePath.endsWith('/')) {
        const ext = filePath.split('.').pop()
        const mime = {
            js: 'application/javascript', css: 'text/css',
            html: 'text/html', svg: 'image/svg+xml',
            png: 'image/png', ico: 'image/x-icon', json: 'application/json',
        }[ext] || 'application/octet-stream'
        const data = await readFile(filePath)
        res.writeHead(200, { 'Content-Type': mime })
        res.end(data)
    } else {
        const index = await readFile(join(DIST, 'index.html'))
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(index)
    }
}

async function main() {

    let vite = null
    if (DEV) {
        const { createServer: createViteServer } = await import('vite')
        vite = await createViteServer({
            configFile: join(import.meta.dirname, '..', 'frontend', 'vite.config.js'),
            root: join(import.meta.dirname, '..', 'frontend'),
            server: { middlewareMode: true },
            appType: 'spa',
        })
    }

    const server = http.createServer(async (req, res) => {
        const pathname = new URL(req.url, 'http://localhost').pathname
        console.log(`[req] ${req.method} ${pathname}`)

        if (pathname.startsWith('/api/') || pathname.startsWith('/eval/')) {
            let body = {}
            if (req.method === 'POST' || req.method === 'PUT') {
                body = await readBody(req)
                console.log(`[req] body keys:`, Object.keys(body))
            }
            const handled = await dispatch(req, res, body, pathname)
            if (!handled) {
                console.log(`[req] no route matched for ${req.method} ${pathname}`)
                res.writeHead(404, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: 'not found' }))
            }
        } else {
            if (DEV) {
                vite.middlewares(req, res, () => {
                    res.writeHead(404)
                    res.end('Not found')
                })
            } else {
                await serveStatic(req, res)
            }
        }
    })

    server.listen(PORT, () => {
        console.log(`[server] ${DEV ? 'dev' : 'prod'} listening on http://localhost:${PORT}`)
    })

    process.on('SIGTERM', async () => {
        server.close()
        if (vite) await vite.close()
    })
}

main().catch(err => {
    console.error('[startup] fatal:', err)
    process.exit(1)
})
