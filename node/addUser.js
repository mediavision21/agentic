#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { createUser } from './sqlite.js'

const [username, password] = process.argv.slice(2)

if (!username || !password) {
	console.error('Usage: node addUser.js <username> <password>')
	process.exit(1)
}

const passwordHash = createHash('sha256').update(password).digest('hex')
const ok = createUser(username, passwordHash)

if (ok) {
	console.log(`User '${username}' created successfully.`)
} else {
	console.error(`Error: User '${username}' already exists.`)
	process.exit(1)
}
