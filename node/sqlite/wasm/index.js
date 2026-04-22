// Main thread API — async wrapper over Web Worker
// call init() once first, then open() returns a db handle (integer)

console.log('[index] creating worker')
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
const pending = new Map()
let nextId = 0

worker.onmessage = function({ data }) {
    console.log('[index] worker message', data)
    const p = pending.get(data.id)
    if (p) {
        pending.delete(data.id)
        if (data.type === 'result') {
            p.resolve(data.value)
        }
        else {
            p.reject(new Error(data.message))
        }
    }
}

worker.onerror = function(err) {
    console.log('[index] worker error message=' + err.message + ' filename=' + err.filename + ':' + err.lineno + ' type=' + err.type)
    for (const p of pending.values()) {
        p.reject(new Error(err.message || 'worker load failed'))
    }
    pending.clear()
}

worker.onmessageerror = function(err) {
    console.log('[index] worker messageerror', err)
}

function send(msg, transfer) {
    const id = ++nextId
    console.log('[index] send', msg.type, 'id=' + id)
    worker.postMessage({ ...msg, id }, transfer ?? [])
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
    })
}

export const init  = ()                => send({ type: 'init' })
export const open  = (path)            => send({ type: 'open', path })
export const load  = (path, buffer)    => send({ type: 'load', path, buffer }, [buffer])
export const close = (db)              => send({ type: 'close', db })
export const exec  = (db, sql)         => send({ type: 'exec', db, sql })
export const query = (db, sql, params) => send({ type: 'query', db, sql, params: params ?? [] })
export const run   = (db, sql, params) => send({ type: 'run', db, sql, params: params ?? [] })
