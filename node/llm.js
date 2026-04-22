import Anthropic from '@anthropic-ai/sdk'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { saveLog } from './sqlite.js'

const client = new Anthropic({ apiKey: process.env.API_KEY })

const MODELS = {
    sonnet: 'claude-sonnet-4-6',
    haiku: 'claude-haiku-4-5-20251001',
}

const LOGS_DIR = join(import.meta.dirname, '..', 'logs')

function _makeTimestampId() {
    const now = new Date()
    const ts = now.toISOString().replace('T', ' ').slice(0, 19)
    const ns = (now.getMilliseconds() * 1000000).toString().padStart(9, '0')
    return `${ts}.${ns}`
}

function _writeDbLog(logId, systemPrompt, messages, response, meta, label, user, conversationId) {
    try {
        const id = logId || _makeTimestampId()
        const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null
        const prompt = lastMsg
            ? (typeof lastMsg.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg.content))
            : ''
        saveLog(id, prompt, systemPrompt, messages, response, meta.model || '', meta.usage || {}, user, conversationId)
    } catch (e) {
        console.log('[llm] db log error:', e.message)
    }
}

export async function* complete(options) {
    const {
        system: systemPrompt,
        messages,
        model: modelKey = 'sonnet',
        tools,
        tool_handler: toolHandler,
        max_iterations,
        label = 'llm',
        log_id: logId,
        user = '',
        conversation_id: conversationId = '',
        prefill,
        stop_sequences: stopSequences,
    } = options

    const maxIterations = max_iterations !== undefined ? max_iterations : (tools ? 5 : 1)
    const maxTokens = options.max_tokens !== undefined ? options.max_tokens : (modelKey === 'haiku' ? 100 : 4096)
    const model = MODELS[modelKey] || modelKey
    const conv = messages.map(m => ({ ...m }))
    let totalInput = 0
    let totalOutput = 0
    let finalModel = model

    for (let iteration = 0; iteration < maxIterations; iteration++) {
        const iterLabel = tools ? `${label} iter=${iteration}` : label
        yield { type: 'round', label: iterLabel }
        yield { type: 'prompt', text: systemPrompt }
        yield { type: 'messages', messages: conv.map(m => ({ ...m })) }

        let iterText = ''
        let callConv = conv
        if (prefill && iteration === 0) {
            callConv = [...conv, { role: 'assistant', content: prefill }]
        }

        const streamParams = {
            model,
            max_tokens: maxTokens,
            temperature: 0,
            system: systemPrompt,
            messages: callConv,
        }
        if (tools) streamParams.tools = tools
        if (stopSequences) streamParams.stop_sequences = stopSequences

        const stream = client.messages.stream(streamParams)
        for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                const text = event.delta.text
                iterText += text
                yield { type: 'token', text }
            }
        }
        const final = await stream.finalMessage()
        finalModel = final.model
        const usage = { input_tokens: final.usage.input_tokens, output_tokens: final.usage.output_tokens }
        totalInput += usage.input_tokens || 0
        totalOutput += usage.output_tokens || 0

        const toolBlocks = final.content.filter(b => b.type === 'tool_use')
        const responseParts = []
        if (iterText.trim()) responseParts.push(iterText.trim())
        for (const b of toolBlocks) {
            const sqlVal = b.input?.sql
            if (sqlVal) {
                responseParts.push(`→ tool_use: ${b.name}\n\`\`\`sql\n${sqlVal}\n\`\`\``)
            } else {
                responseParts.push(`→ tool_use: ${b.name}\n\`\`\`json\n${JSON.stringify(b.input, null, 2)}\n\`\`\``)
            }
        }
        const responseText = responseParts.length > 0 ? responseParts.join('\n\n') : iterText
        yield { type: 'response', text: responseText }

        // write debug log files
        try {
            mkdirSync(LOGS_DIR, { recursive: true })
            const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
            writeFileSync(join(LOGS_DIR, `${ts}-${iterLabel}-request.md`),
                `system:\n${systemPrompt}\n\nmessages:\n${JSON.stringify(conv, null, 2)}`)
        } catch (_) {
            // ignore log write errors
        }
        _writeDbLog(logId, systemPrompt, conv, iterText, { model: final.model, usage }, iterLabel, user, conversationId)

        if (tools) {
            if (final.stop_reason !== 'tool_use') break

            const assistantContent = []
            for (const block of final.content) {
                if (block.type === 'text') {
                    assistantContent.push({ type: 'text', text: block.text })
                } else if (block.type === 'tool_use') {
                    assistantContent.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input })
                }
            }
            conv.push({ role: 'assistant', content: assistantContent })

            const toolResults = []
            for (const block of final.content) {
                if (block.type === 'tool_use') {
                    yield { type: 'tool_call', name: block.name, input: block.input, id: block.id }
                    const handlerResult = await toolHandler(block.name, block.input)
                    for (const ev of (handlerResult.events || [])) {
                        yield ev
                    }
                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: block.id,
                        content: handlerResult.content || '',
                    })
                    yield { type: 'tool_result', name: block.name, id: block.id, rows: handlerResult.rows || 0 }
                }
            }
            conv.push({ role: 'user', content: toolResults })
        } else {
            break
        }
    }

    yield { type: 'meta', model: finalModel, usage: { input_tokens: totalInput, output_tokens: totalOutput } }
}

export async function completeText(options) {
    let full = ''
    for await (const ev of complete(options)) {
        if (ev.type === 'token') {
            full += ev.text
        }
    }
    return full.trim()
}
