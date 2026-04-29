import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { dump as yamlDump } from 'js-yaml'

const TEMPLATE_DIR = join(import.meta.dirname, '..', 'template')
export const NEW_TEMPLATE_DIR = join(TEMPLATE_DIR, 'new')

mkdirSync(NEW_TEMPLATE_DIR, { recursive: true })

export function plotConfigToJs(config) {
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

// saves content (from agent stream) as a template YAML into the given dir
export function saveTemplateFromContent(content, dir) {
    const sql = content.sql || ''
    if (!sql) return null

    const desc = content.user_prompt || content.summary || ''
    let safeName = desc.trim().replace(/[^a-zA-Z0-9_\-\s]/g, '_').slice(0, 60).trim().replace(/\s+/g, '_').toLowerCase()
    if (!safeName) safeName = (content.msg_id || 'unknown').replace(/[^a-zA-Z0-9_\-]/g, '_')

    const tpl = { description: desc, sql }

    const templatePlots = content.template_plots
    const plotConfig = content.plot_config

    if (templatePlots && templatePlots.length > 0) {
        tpl.plots = templatePlots.map(p => ({ ...p }))
    } else {
        if (plotConfig) {
            tpl.plots = [{ id: 'chart', title: desc.slice(0, 80), config: JSON.stringify(plotConfig, null, 4) }]
        }
    }

    const now = new Date()
    const ts = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0') + '_' +
        String(now.getHours()).padStart(2, '0') + '-' +
        String(now.getMinutes()).padStart(2, '0') + '-' +
        String(now.getSeconds()).padStart(2, '0')
    tpl.timestamp = ts
    const path = join(dir, safeName + '_' + ts + '.yaml')
    writeFileSync(path, yamlDump(tpl, { lineWidth: -1, noRefs: true }))
    return path
}
