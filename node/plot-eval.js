import { parseArgs } from 'node:util'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { load as yamlLoad, dump as yamlDump } from 'js-yaml'
import { initPool, closePool, executeQuery } from './db.js'
import { loadTemplates } from './template_router.js'
import { detectPlaceholders, buildDefaultFilters, applyFilters } from './template_filters.js'
import { generatePlotAndSummary } from './plot.js'

const SKILLS_DIR = join(import.meta.dirname, '..', 'skills')
const EVAL_OUTPUT = join(import.meta.dirname, '..', 'eval-output')
const RENDER_SCRIPT = join(import.meta.dirname, '..', 'eval', 'render_plot.mjs')

function parseCliArgs() {
    const { values } = parseArgs({
        args: process.argv.slice(2),
        options: {
            versions: { type: 'string', default: 'v3' },
            limit: { type: 'string', default: '5' },
            template: { type: 'string', default: '' },
        },
    })
    return {
        versions: values.versions.split(',').map(v => v.trim()),
        limit: parseInt(values.limit, 10),
        template: values.template || null,
    }
}

function filterTemplates(templates, templateArg, limit) {
    const keys = Object.keys(templates)
    if (templateArg !== null) {
        if (/^\d+$/.test(templateArg)) {
            const idx = parseInt(templateArg, 10)
            return idx < keys.length ? [[keys[idx], templates[keys[idx]]]] : []
        }
        if (/^\d+-\d+$/.test(templateArg)) {
            const [start, end] = templateArg.split('-').map(Number)
            return keys.slice(start, end + 1).map(k => [k, templates[k]])
        }
        return keys.filter(k => k.includes(templateArg)).map(k => [k, templates[k]])
    }
    return keys.slice(0, limit).map(k => [k, templates[k]])
}

function renderSvg(config, rows) {
    return new Promise((resolve) => {
        const payload = JSON.stringify({ config, rows: (rows || []).slice(0, 50) })
        const proc = spawn('node', [RENDER_SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] })
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

async function getTemplateData(sql, yamlFilters) {
    const names = detectPlaceholders(sql)
    const resolved = await buildDefaultFilters(names, yamlFilters)
    const result = await executeQuery(applyFilters(sql, resolved))
    return [result.columns, result.rows]
}

async function main() {
    const { versions, limit, template: templateArg } = parseCliArgs()

    await initPool()
    const templates = loadTemplates()
    const templateList = filterTemplates(templates, templateArg, limit)

    const promptByVersion = {}
    for (const version of versions) {
        promptByVersion[version] = yamlLoad(readFileSync(join(SKILLS_DIR, `plot-${version}.yaml`), 'utf8'))
    }

    mkdirSync(EVAL_OUTPUT, { recursive: true })
    const results = {}

    for (const [fname, tdata] of templateList) {
        const sql = tdata.sql
        if (!sql) {
            console.log(`[skip] ${fname} — no sql`)
            continue
        }

        let columns, rows
        try {
            ;[columns, rows] = await getTemplateData(sql, tdata.filters || null)
        } catch (e) {
            console.log(`[error] ${fname} sql: ${e.message}`)
            continue
        }

        if (!rows || rows.length === 0) {
            console.log(`[skip] ${fname} — no rows`)
            continue
        }

        results[fname] = { description: tdata.description || fname, columns, rows, versions: {} }

        for (const version of versions) {
            const name = fname.replace(/\//g, '_').replace(/\.yaml$/, '')
            try {
                const [plotConfig] = await generatePlotAndSummary({
                    user_prompt: tdata.description || fname,
                    columns,
                    rows,
                    label: `eval-${version}-${name}`,
                    prompt_data: promptByVersion[version],
                })

                if (!plotConfig) {
                    console.log(`[fail] ${fname} [${version}] — no plot_config from LLM`)
                    continue
                }

                const [svg, err] = await renderSvg(plotConfig, rows)
                if (err) {
                    console.log(`[fail] ${fname} [${version}] — ${err.slice(0, 120)}`)
                    continue
                }

                results[fname].versions[version] = { svg, config: plotConfig }
                console.log(`[ok]   ${fname} [${version}]`)
            } catch (e) {
                console.log(`[error] ${fname} [${version}]: ${e.message}`)
            }
        }
    }

    await closePool()

    for (const [fname, data] of Object.entries(results)) {
        const safeName = fname.replace(/\//g, '_').replace(/\.yaml$/, '')
        const versionsStr = versions.join('-')
        const outPath = join(EVAL_OUTPUT, `${safeName}_${versionsStr}.yaml`)

        const dataSection = {}
        for (const v of versions) {
            const vdata = data.versions[v]
            if (vdata && vdata.config) {
                dataSection[v] = JSON.stringify(vdata.config, null, 2)
            }
        }

        const record = {
            name: fname,
            description: data.description,
            columns: data.columns,
            rows: (data.rows || []).slice(0, 50),
            data: dataSection,
        }

        writeFileSync(outPath, yamlDump(record, { lineWidth: -1, noRefs: true }))
        console.log(`[yaml]   ${outPath}`)
    }
}

main().catch(e => { console.error(e); process.exit(1) })
