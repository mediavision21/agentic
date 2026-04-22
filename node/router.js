import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { load as yamlLoad, dump as yamlDump } from 'js-yaml'
import { getCurrentUser, makeSessionToken, checkRateLimit, incrementRateLimit, clearRateLimit, SESSION_COOKIE_MAX_AGE } from './auth.js'
import { executeQuery } from './db.js'
import { verifyUser, saveConversation, getConversations, getAllConversationsByUser, getConversationMessages, saveEvaluation, getEvaluations, getEvaluatedSessions, getConversationEvaluations, getResultData } from './sqlite.js'
import { detectPlaceholders, buildDefaultFilters, applyFilters } from './template_filters.js'
import { loadTemplates } from './template_router.js'
import { generateAgentStream } from './agent.js'

const TEMPLATE_DIR = join(import.meta.dirname, '..', 'backend', 'template')
const EVAL_TEMPLATE_DIR = join(TEMPLATE_DIR, 'evaluations')
const EVAL_OUTPUT = join(import.meta.dirname, '..', 'eval-output')
const RENDER_SCRIPT = join(import.meta.dirname, '..', 'eval', 'render_plot.mjs')

mkdirSync(EVAL_TEMPLATE_DIR, { recursive: true })

function sendJson(res, data, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data))
}

function getClientIp(req) {
    return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim()
}

// route table — ordered by specificity
const ROUTES = [
    { method: 'GET',  pattern: '/api/health',                   auth: false, handler: handleHealth },
    { method: 'GET',  pattern: '/api/me',                       auth: false, handler: handleMe },
    { method: 'POST', pattern: '/api/login',                    auth: false, handler: handleLogin },
    { method: 'POST', pattern: '/api/ask',                      auth: true,  handler: handleAsk },
    { method: 'POST', pattern: '/api/sql',                      auth: true,  handler: handleSql },
    { method: 'POST', pattern: '/api/conversations',            auth: true,  handler: handleCreateConversation },
    { method: 'GET',  pattern: '/api/conversations',            auth: true,  handler: handleListConversations },
    { method: 'GET',  pattern: /^\/api\/conversations\/([^\/]+)\/evaluations$/, auth: true, handler: handleConversationEvals, paramNames: ['conv_id'] },
    { method: 'GET',  pattern: /^\/api\/conversations\/([^\/]+)$/, auth: true, handler: handleGetConversation, paramNames: ['conv_id'] },
    { method: 'POST', pattern: '/api/evaluate',                 auth: true,  handler: handleEvaluate },
    { method: 'GET',  pattern: '/api/evaluations',              auth: true,  handler: handleListEvaluations },
    { method: 'GET',  pattern: '/api/evaluated-sessions',       auth: true,  handler: handleEvaluatedSessions },
    { method: 'GET',  pattern: '/api/admin/conversations',      auth: true,  handler: handleAdminConversations },
    { method: 'GET',  pattern: '/api/templates',                auth: true,  handler: handleListTemplates },
    { method: 'GET',  pattern: /^\/api\/templates\/(.+)$/,      auth: true,  handler: handleRunTemplate, paramNames: ['name'] },
    { method: 'GET',  pattern: '/eval/files',                   auth: false, handler: handleEvalFiles },
    { method: 'GET',  pattern: /^\/eval\/files\/([^\/]+)$/,     auth: false, handler: handleEvalFile, paramNames: ['name'] },
    { method: 'POST', pattern: '/eval/render',                  auth: false, handler: handleEvalRender },
    { method: 'POST', pattern: '/eval/score',                   auth: false, handler: handleEvalScore },
]

export async function dispatch(req, res, body, pathname) {
    const method = req.method
    for (const route of ROUTES) {
        let params = {}
        if (route.method !== method) continue
        if (typeof route.pattern === 'string') {
            if (pathname !== route.pattern) continue
        } else {
            const m = pathname.match(route.pattern)
            if (!m) continue
            if (route.paramNames) {
                for (let i = 0; i < route.paramNames.length; i++) {
                    params[route.paramNames[i]] = m[i + 1]
                }
            }
        }

        if (route.auth) {
            const username = getCurrentUser(req)
            if (username) {
                await route.handler(req, res, body, params, username)
            } else {
                sendJson(res, { error: 'Not authenticated' }, 401)
            }
        } else {
            await route.handler(req, res, body, params, null)
        }
        return true
    }
    return false
}

// --- handlers ---

async function handleHealth(req, res) {
    sendJson(res, { status: 'ok' })
}

async function handleMe(req, res) {
    const username = getCurrentUser(req)
    if (username) {
        sendJson(res, { ok: true, username })
    } else {
        sendJson(res, { ok: false })
    }
}

async function handleLogin(req, res, body) {
    const ip = getClientIp(req)
    const rl = checkRateLimit(ip)
    if (!rl.allowed) {
        sendJson(res, { ok: false, error: rl.error }, 429)
        return
    }

    const { username = '', password = '' } = body
    if (!username || username.length > 64 || !/^[a-zA-Z0-9]+$/.test(username)) {
        incrementRateLimit(ip)
        sendJson(res, { ok: false, error: 'Invalid username or password' })
        return
    }

    if (verifyUser(username, password)) {
        clearRateLimit(ip)
        const token = makeSessionToken(username)
        const isHttps = (req.headers['x-forwarded-proto'] || 'http') === 'https'
        const cookieFlags = `Max-Age=${SESSION_COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${isHttps ? '; Secure' : ''}`
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': `mv_session=${token}; ${cookieFlags}`,
        })
        res.end(JSON.stringify({ ok: true, username }))
    } else {
        incrementRateLimit(ip)
        sendJson(res, { ok: false, error: 'Invalid username or password' })
    }
}

async function handleAsk(req, res, body, params, username) {
    const prompt = (body.prompt || '').slice(0, 4000)
    const history = (body.history || []).slice(0, 50)
    const sessionId = (body.session_id || '').slice(0, 64)

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    })

    try {
        for await (const event of generateAgentStream(prompt, history, { user: username || '', conversationId: sessionId })) {
            res.write(`data: ${JSON.stringify(event)}\n\n`)
        }
    } catch (e) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: String(e.message) })}\n\n`)
    }
    res.end()
}

async function handleSql(req, res, body, params, username) {
    const sql = (body.sql || '').slice(0, 4000)
    try {
        const data = await executeQuery(sql)
        sendJson(res, { sql, columns: data.columns, rows: data.rows })
    } catch (e) {
        sendJson(res, { error: `SQL error: ${e.message}`, sql, columns: [], rows: [] })
    }
}

async function handleCreateConversation(req, res, body, params, username) {
    const id = (body.id || '').slice(0, 64)
    const title = (body.title || '').slice(0, 200)
    saveConversation(id, username, title)
    sendJson(res, { ok: true })
}

async function handleListConversations(req, res, body, params, username) {
    sendJson(res, { conversations: getConversations(username) })
}

async function handleGetConversation(req, res, body, params, username) {
    const messages = getConversationMessages(params.conv_id, username)
    sendJson(res, { messages })
}

async function handleAdminConversations(req, res, body, params, username) {
    if (username === 'rockie') {
        sendJson(res, { groups: getAllConversationsByUser() })
    } else {
        sendJson(res, { error: 'Forbidden' }, 403)
    }
}

function _plotConfigToJs(config) {
    if (!config || !config.marks || config.marks.length === 0) return null
    const marks = config.marks
    const xCfg = config.x || {}
    const yCfg = config.y || {}
    const colCfg = config.color || {}
    const fxCfg = config.fx

    const yCol = marks[0].y || 'value'
    const colorCol = marks.map(m => m.fill || m.stroke).find(Boolean) || null
    const needsPeriodSort = colorCol === 'period_label'

    const lines = [
        'var rows = data.map(function(d) {',
        `    return Object.assign({}, d, { ${yCol}: +d.${yCol} });`,
        '});',
    ]

    if (needsPeriodSort) {
        lines.push(
            '// sort period_label domain chronologically via period_sort',
            'var _periodOrder = [];',
            'var _seenP = {};',
            'data.slice().sort(function(a, b) { return +a.period_sort - +b.period_sort; }).forEach(function(d) {',
            '    if (!_seenP[d.period_label]) { _seenP[d.period_label] = true; _periodOrder.push(d.period_label); }',
            '});',
        )
    }

    const MARK_FN = { lineY: 'Plot.lineY', barY: 'Plot.barY', dot: 'Plot.dot', areaY: 'Plot.areaY' }
    const markLines = []
    for (const m of marks) {
        const fn = MARK_FN[m.type] || 'Plot.lineY'
        const opts = {}
        for (const k of ['x', 'y', 'stroke', 'fill', 'fx', 'curve']) {
            if (m[k] != null) opts[k] = m[k]
        }
        if (m.type === 'lineY' && !opts.curve) opts.curve = 'catmull-rom'
        const optsJs = Object.entries(opts).map(([k, v]) => `"${k}": "${v}"`).join(', ')
        markLines.push(`    ${fn}(rows, { ${optsJs} })`)
        if (m.type === 'lineY') {
            const stroke = m.stroke || m.fill
            let dotJs = `"x": "${m.x}", "y": "${m.y}"`
            if (stroke) dotJs += `, "fill": "${stroke}"`
            dotJs += ', "r": 3'
            markLines.push(`    Plot.dot(rows, { ${dotJs} })`)
        }
        if (m.type === 'barY') {
            markLines.push('    Plot.ruleY([0])')
        }
    }

    let colorExpr = '{ "legend": true'
    if (needsPeriodSort) {
        colorExpr += ', domain: _periodOrder'
    } else if (colCfg) {
        for (const [k, v] of Object.entries(colCfg)) {
            if (k !== 'legend') colorExpr += `, "${k}": ${JSON.stringify(v)}`
        }
    }
    colorExpr += ' }'

    const plotParts = [`    marks: [\n${markLines.join(',\n')}\n    ]`]
    if (Object.keys(xCfg).length > 0) {
        plotParts.push(`    x: { ${Object.entries(xCfg).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')} }`)
    }
    if (Object.keys(yCfg).length > 0) {
        plotParts.push(`    y: { ${Object.entries(yCfg).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')} }`)
    }
    plotParts.push(`    color: ${colorExpr}`)
    if (fxCfg) {
        plotParts.push(`    fx: ${JSON.stringify(fxCfg)}`)
    }

    lines.push('return Plot.plot({')
    lines.push(plotParts.join(',\n') + ',')
    lines.push('});')
    return lines.join('\n')
}

async function handleEvaluate(req, res, body, params, username) {
    const msgId = (body.msg_id || '').slice(0, 64)
    const rating = body.rating
    const user = username || (body.user || '').slice(0, 64)
    const comment = (body.comment || '').slice(0, 2000)

    if (!/^(good|bad)$/.test(rating)) {
        sendJson(res, { error: 'Invalid rating' }, 400)
        return
    }

    saveEvaluation(msgId, rating, user, comment)

    if (rating === 'good') {
        const rd = getResultData(msgId)
        const sql = rd.sql || ''
        if (sql) {
            const desc = comment || rd.user_prompt || msgId
            let safeName = desc.trim().replace(/[^a-zA-Z0-9_\-\s]/g, '_').slice(0, 60).trim().replace(/\s+/g, '_').toLowerCase()
            if (!safeName) safeName = msgId.replace(/[^a-zA-Z0-9_\-]/g, '_')

            const tpl = { description: desc, sql }
            const templatePlots = rd.template_plots
            const plotConfig = rd.plot_config

            if (templatePlots && templatePlots.length > 0) {
                tpl.plots = templatePlots.map(p => ({ ...p }))
            } else {
                const js = _plotConfigToJs(plotConfig)
                if (js) {
                    tpl.plots = [{ id: 'chart', title: desc.slice(0, 80), code: js }]
                }
            }

            const path = join(EVAL_TEMPLATE_DIR, safeName + '.yaml')
            writeFileSync(path, yamlDump(tpl, { lineWidth: -1, noRefs: true }))
            console.log('[evaluate] saved template', path)
        }
    }

    sendJson(res, { ok: true })
}

async function handleListEvaluations(req, res) {
    sendJson(res, { evaluations: getEvaluations() })
}

async function handleEvaluatedSessions(req, res) {
    sendJson(res, { sessions: getEvaluatedSessions() })
}

async function handleConversationEvals(req, res, body, params) {
    sendJson(res, { evaluations: getConversationEvaluations(params.conv_id) })
}

function _safeYamlPath(name) {
    if (name.includes('\\') || name.split('/').includes('..')) return null
    const path = join(TEMPLATE_DIR, name)
    // simple check: resolved path must start with TEMPLATE_DIR
    if (!path.startsWith(TEMPLATE_DIR + '/') && path !== TEMPLATE_DIR) return null
    return path
}

async function handleListTemplates(req, res) {
    const result = []
    function _recurse(dir, base) {
        const entries = readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
            const full = join(dir, entry.name)
            if (entry.isDirectory()) {
                _recurse(full, base)
            } else if (entry.isFile() && extname(entry.name) === '.yaml') {
                const rel = full.slice(base.length + 1)
                try {
                    const data = yamlLoad(readFileSync(full, 'utf8'))
                    const folder = dirname(rel)
                    const category = folder !== '.' ? folder : (data.category || '')
                    result.push({
                        name: rel.slice(0, -5),  // strip .yaml
                        category,
                        description: data.description || '',
                        status: data.status || '',
                    })
                } catch (_) {}
            }
        }
    }
    _recurse(TEMPLATE_DIR, TEMPLATE_DIR)
    result.sort((a, b) => a.name.localeCompare(b.name))
    sendJson(res, { templates: result })
}

async function handleRunTemplate(req, res, body, params) {
    const name = params.name
    const fname = name.endsWith('.yaml') ? name : name + '.yaml'
    const path = _safeYamlPath(fname)

    if (path) {
        try {
            const data = yamlLoad(readFileSync(path, 'utf8'))
            let sql = data.sql || ''
            const plots = data.plots || []
            const placeholders = detectPlaceholders(sql)
            if (placeholders.length > 0) {
                const yamlFilters = data.filters || null
                const defaults = await buildDefaultFilters(placeholders, yamlFilters)
                sql = applyFilters(sql, defaults)
            }
            try {
                const result = await executeQuery(sql)
                sendJson(res, {
                    name,
                    description: data.description || '',
                    sql,
                    columns: result.columns,
                    rows: result.rows,
                    plots,
                })
            } catch (e) {
                sendJson(res, { error: String(e.message), sql, columns: [], rows: [], plots })
            }
        } catch (e) {
            sendJson(res, { error: 'not found' }, 404)
        }
    } else {
        sendJson(res, { error: 'not found' }, 404)
    }
}

// --- eval routes ---

async function _renderSvg(config, rows) {
    return new Promise((resolve) => {
        const payload = JSON.stringify({ config, rows: (rows || []).slice(0, 50) })
        const proc = spawn('node', [RENDER_SCRIPT], {
            stdio: ['pipe', 'pipe', 'pipe'],
        })
        const outChunks = []
        const errChunks = []
        proc.stdout.on('data', chunk => outChunks.push(chunk))
        proc.stderr.on('data', chunk => errChunks.push(chunk))
        proc.on('close', code => {
            if (code !== 0) {
                resolve([null, Buffer.concat(errChunks).toString().trim()])
            } else {
                resolve([Buffer.concat(outChunks).toString(), null])
            }
        })
        proc.stdin.write(payload)
        proc.stdin.end()
    })
}

async function handleEvalFiles(req, res) {
    try {
        mkdirSync(EVAL_OUTPUT, { recursive: true })
        const files = readdirSync(EVAL_OUTPUT)
            .filter(f => f.endsWith('.yaml'))
            .map(f => ({ name: f, mtime: 0 }))
        sendJson(res, files.map(f => f.name))
    } catch (_) {
        sendJson(res, [])
    }
}

async function handleEvalFile(req, res, body, params) {
    const name = params.name
    if (!name.endsWith('.yaml') || name.includes('/') || name.includes('..')) {
        sendJson(res, { error: 'invalid' }, 400)
        return
    }
    const path = join(EVAL_OUTPUT, name)
    try {
        const data = yamlLoad(readFileSync(path, 'utf8'))
        sendJson(res, data)
    } catch (_) {
        sendJson(res, { error: 'not found' }, 404)
    }
}

async function handleEvalRender(req, res, body) {
    const [svg, err] = await _renderSvg(body.config, body.rows || [])
    if (err) {
        sendJson(res, { error: err }, 400)
    } else {
        sendJson(res, { svg })
    }
}

async function handleEvalScore(req, res, body) {
    const config = body.config
    const rows = body.rows || []
    const description = body.description || ''

    const [svg, err] = await _renderSvg(config, rows)
    if (err) {
        sendJson(res, { error: `render: ${err}` }, 400)
        return
    }

    // SVG-to-PNG conversion requires @resvg/resvg-js or similar
    // For now return the svg score as text-only via Claude
    try {
        const Anthropic = (await import('@anthropic-ai/sdk')).default
        const client = new Anthropic({ apiKey: process.env.API_KEY })
        const msg = await client.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 512,
            system: 'You are a data visualization expert. Evaluate chart configs for clarity, appropriate mark selection, and data representation accuracy.',
            messages: [{
                role: 'user',
                content: `Chart description: ${description}\n\nChart SVG config (evaluate the structure, not the rendering):\n${svg?.slice(0, 2000) || '(none)'}\n\nScore this chart 1-10 for data visualization quality. Return JSON only: {"score": N, "reasoning": "..."}`,
            }],
        })
        const text = msg.content[0].text
        const m = text.match(/\{.*?\}/s)
        if (m) {
            try {
                sendJson(res, JSON.parse(m[0]))
                return
            } catch (_) {}
        }
        sendJson(res, { score: null, reasoning: text })
    } catch (e) {
        sendJson(res, { error: e.message }, 500)
    }
}
