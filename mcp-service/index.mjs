#!/usr/bin/env node
/**
 * alphalens-mcp-server — read-only MCP tools over the AlphaLens public API.
 *
 * stdio transport: the client launches this as a subprocess and speaks
 * newline-delimited JSON-RPC over stdin/stdout. Nothing but MCP messages may
 * be written to stdout, so all logging goes to stderr.
 */

import { runStdio, SERVER_INFO } from './lib/server.mjs'
import { apiBase } from './lib/api.mjs'

console.error(`[alphalens-mcp] ${SERVER_INFO.name} ${SERVER_INFO.version} reading ${apiBase()}`)

runStdio()
