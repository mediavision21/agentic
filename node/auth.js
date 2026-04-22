import { createHmac, timingSafeEqual } from 'node:crypto'

const SESSION_SECRET = process.env.SESSION_SECRET || 'mv-default-secret-change-me'
const SESSION_MAX_AGE = 7 * 24 * 3600  // 7 days in seconds
const LOGIN_RATE_WINDOW = 300
const LOGIN_RATE_LIMIT = 10

const _loginAttempts = new Map()  // ip -> {count, firstTime}

export function makeSessionToken(username) {
    const expires = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE
    const payload = `${username}:${expires}`
    const sig = createHmac('sha256', SESSION_SECRET).update(payload).digest('hex')
    return `${payload}:${sig}`
}

export function verifySessionToken(token) {
    if (!token) return null
    const parts = token.split(':')
    if (parts.length !== 3) return null
    const [username, expiresStr, sig] = parts
    const payload = `${username}:${expiresStr}`
    const expected = createHmac('sha256', SESSION_SECRET).update(payload).digest('hex')
    // compare as buffers of equal length (both are 64-char hex strings)
    const sigBuf = Buffer.from(sig.padEnd(64, '0').slice(0, 64))
    const expBuf = Buffer.from(expected.padEnd(64, '0').slice(0, 64))
    if (!timingSafeEqual(sigBuf, expBuf)) return null
    if (sig !== expected) return null  // length mismatch guard
    if (parseInt(expiresStr, 10) < Math.floor(Date.now() / 1000)) return null
    return username
}

export function parseCookies(req) {
    const header = req.headers.cookie || ''
    const cookies = {}
    for (const part of header.split(';')) {
        const [k, ...v] = part.trim().split('=')
        if (k) cookies[decodeURIComponent(k.trim())] = decodeURIComponent(v.join('=').trim())
    }
    return cookies
}

export function getCurrentUser(req) {
    const cookies = parseCookies(req)
    return verifySessionToken(cookies.mv_session || null)
}

export function checkRateLimit(ip) {
    const now = Date.now() / 1000
    const entry = _loginAttempts.get(ip) || { count: 0, firstTime: now }
    if (now - entry.firstTime > LOGIN_RATE_WINDOW) {
        _loginAttempts.set(ip, { count: 0, firstTime: now })
        return { allowed: true, count: 0, firstTime: now }
    }
    if (entry.count >= LOGIN_RATE_LIMIT) {
        return { allowed: false, error: 'Too many login attempts, try again later' }
    }
    return { allowed: true, count: entry.count, firstTime: entry.firstTime }
}

export function incrementRateLimit(ip) {
    const now = Date.now() / 1000
    const entry = _loginAttempts.get(ip) || { count: 0, firstTime: now }
    _loginAttempts.set(ip, { count: entry.count + 1, firstTime: entry.firstTime })
}

export function clearRateLimit(ip) {
    _loginAttempts.delete(ip)
}

export const SESSION_COOKIE_MAX_AGE = SESSION_MAX_AGE
