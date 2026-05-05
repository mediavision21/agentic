import { open, exec, query, run } from '../sqlite/index.js'
import { pbkdf2Sync, randomBytes } from 'node:crypto'
import { join } from 'node:path'

const DB_PATH = join(import.meta.dirname, '..', 'mediavision.db')

let _db = null

function db() {
    if (!_db) {
        _db = open(DB_PATH)
        exec(_db, `
            CREATE TABLE IF NOT EXISTS llm_logs (
                id TEXT PRIMARY KEY,
                timestamp TEXT,
                prompt TEXT,
                system_prompt TEXT,
                messages TEXT,
                response TEXT,
                model TEXT,
                usage TEXT,
                user TEXT DEFAULT '',
                conversation_id TEXT DEFAULT '',
                result_data TEXT DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT
            );
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                user TEXT,
                title TEXT,
                created_at TEXT
            );
            CREATE TABLE IF NOT EXISTS evaluations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                log_id TEXT,
                rating TEXT,
                user TEXT,
                comment TEXT,
                timestamp TEXT
            );
        `)
        console.log('[sqlite] db initialized')
    }
    return _db
}

function _hashPassword(password, salt = null) {
    if (!salt) salt = randomBytes(16).toString('hex')
    const dk = pbkdf2Sync(password, salt, 100000, 32, 'sha256')
    return `${salt}:${dk.toString('hex')}`
}

function _verifyPassword(password, stored) {
    const salt = stored.split(':')[0]
    return _hashPassword(password, salt) === stored
}

export function verifyUser(username, password) {
    const rows = query(db(), 'SELECT password_hash FROM users WHERE username=?', [username])
    if (rows.length > 0) {
        return _verifyPassword(password, rows[0].password_hash)
    } else {
        return false
    }
}

export function saveLog(id, prompt, systemPrompt, messages, response, model, usage, user = '', conversationId = '', resultData = '') {
    const ts = new Date().toISOString()
    const messagesStr = typeof messages === 'string' ? messages : JSON.stringify(messages)
    const usageStr = typeof usage === 'string' ? usage : JSON.stringify(usage)
    const resultStr = typeof resultData === 'object' && resultData !== null ? JSON.stringify(resultData) : (resultData || '')
    run(db(),
        'INSERT OR REPLACE INTO llm_logs (id, timestamp, prompt, system_prompt, messages, response, model, usage, user, conversation_id, result_data) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [id, ts, prompt, systemPrompt, messagesStr, response, model, usageStr, user, conversationId, resultStr]
    )
}

export function getResultData(logId) {
    const rows = query(db(), 'SELECT result_data FROM llm_logs WHERE id=?', [logId])
    if (rows.length > 0 && rows[0].result_data) {
        try {
            return JSON.parse(rows[0].result_data)
        } catch (_) {
            return {}
        }
    }
    return {}
}

export function updateResultData(logId, resultData) {
    const str = typeof resultData === 'object' && resultData !== null ? JSON.stringify(resultData) : (resultData || '')
    run(db(), 'UPDATE llm_logs SET result_data=? WHERE id=?', [str, logId])
}

export function saveConversation(id, user, title) {
    run(db(),
        'INSERT OR IGNORE INTO conversations (id, user, title, created_at) VALUES (?,?,?,?)',
        [id, user, title, new Date().toISOString()]
    )
}

export function getConversations(user) {
    return query(db(),
        'SELECT id, user, title, created_at FROM conversations WHERE user=? ORDER BY created_at DESC',
        [user]
    )
}

export function getAllConversationsByUser() {
    const rows = query(db(),
        'SELECT id, user, title, created_at FROM conversations ORDER BY user ASC, created_at DESC'
    )
    const groups = {}
    for (const r of rows) {
        const u = r.user || ''
        if (!groups[u]) groups[u] = []
        groups[u].push(r)
    }
    return Object.entries(groups).map(([u, convs]) => ({ user: u, conversations: convs }))
}

export function getConversationMessages(conversationId, user = null) {
    if (user) {
        return query(db(),
            'SELECT id, prompt, response, result_data, timestamp FROM llm_logs WHERE conversation_id=? AND user=? ORDER BY timestamp ASC',
            [conversationId, user]
        )
    } else {
        return query(db(),
            'SELECT id, prompt, response, result_data, timestamp FROM llm_logs WHERE conversation_id=? ORDER BY timestamp ASC',
            [conversationId]
        )
    }
}

export function saveEvaluation(logId, rating, user = '', comment = '') {
    run(db(),
        'INSERT INTO evaluations (log_id, rating, user, comment, timestamp) VALUES (?,?,?,?,?)',
        [logId, rating, user, comment, new Date().toISOString()]
    )
}

export function getEvaluations() {
    return query(db(), 'SELECT * FROM evaluations ORDER BY timestamp DESC')
}

export function getEvaluatedSessions() {
    return query(db(), `
        SELECT c.id, c.user, c.title, c.created_at, COUNT(e.id) AS eval_count
        FROM conversations c
        JOIN llm_logs l ON l.conversation_id = c.id
        JOIN evaluations e ON e.log_id = l.id
        GROUP BY c.id
        ORDER BY c.created_at DESC
    `)
}

export function getConversationEvaluations(conversationId) {
    return query(db(), `
        SELECT e.*
        FROM evaluations e
        JOIN llm_logs l ON l.id = e.log_id
        WHERE l.conversation_id = ?
        ORDER BY e.timestamp ASC
    `, [conversationId])
}
