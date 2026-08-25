/**
 * MCP over stdio, hand-rolled — no dependencies, matching the other Node
 * services in this repo (capture-service, verify-service are zero-dep too, and
 * their Dockerfiles never run an install step).
 *
 * The server is dual-era, in the spec's terms: it answers the `initialize`
 * handshake that clients through revision 2025-11-25 expect, and it answers
 * `server/discover` with per-request `_meta` version negotiation for revision
 * 2026-07-28 and later. Both eras reach the same four read-only tools.
 */

import { toolDescriptors, TOOLS_BY_NAME } from './tools.mjs'
import { ApiError, apiBase } from './api.mjs'

export const SERVER_INFO = { name: 'alphalens-mcp-server', version: '0.1.0' }

// Revisions that carry version + capabilities as per-request `_meta`.
export const MODERN_VERSIONS = ['2026-07-28']
// Revisions that establish a session with an `initialize` handshake.
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
export const SUPPORTED_VERSIONS = [...MODERN_VERSIONS, ...LEGACY_VERSIONS]

// What we answer `initialize` with when the client asks for something we do
// not implement — the most widely deployed legacy revision.
export const PREFERRED_LEGACY = '2025-06-18'

export const META_VERSION = 'io.modelcontextprotocol/protocolVersion'
export const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo'

export const CAPABILITIES = { tools: { listChanged: false } }

export const INSTRUCTIONS =
  'AlphaLens is a verification-first trading research project on Hyperliquid. These tools are read-only and ' +
  'expose what AlphaLens publishes: the append-only Ledger of pre-registered calls and their outcomes, the ' +
  'aggregate positioning of the tracked wallet cohort, and the cohort itself. Every response carries a ' +
  '"coverage" block describing what was actually measured and a "caveats" list. Missing data is served as ' +
  'null and never as zero — a gap in capture is the absence of a measurement, not a reading of nothing ' +
  'happened. Nothing here is financial advice or a recommendation to trade.'

// One shape for every tool result, so a client can rely on the envelope even
// though each tool's `data` differs.
const ENVELOPE_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    data: { description: 'The tool-specific payload. Absent measurements are null, never zero.' },
    coverage: { type: 'object', description: 'What this answer actually covers: freshness, counts, completeness.' },
    caveats: { type: 'array', items: { type: 'string' }, description: 'Specific things a reader would otherwise get wrong.' },
    source: { type: 'string', description: 'The public HTTP endpoint this data was read from.' },
    notice: { type: 'string', description: 'Standing no-financial-advice notice.' },
  },
  required: ['data', 'coverage', 'caveats', 'source', 'notice'],
}

/* ------------------------------------------------------------ JSON-RPC bits */

export const ERR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  UNSUPPORTED_PROTOCOL_VERSION: -32022,
}

const result = (id, payload, modern) =>
  ({ jsonrpc: '2.0', id, result: modern ? { resultType: 'complete', ...payload } : payload })

const failure = (id, code, message, data) =>
  ({ jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } })

/** The protocol version a request declares, or null for a legacy request. */
function declaredVersion(msg) {
  const v = msg?.params?._meta?.[META_VERSION]
  return typeof v === 'string' ? v : null
}

/* --------------------------------------------------------------- dispatch */

/**
 * Handle one decoded JSON-RPC message. Returns the response object to write,
 * or null for notifications and for anything that must not be answered.
 *
 * Stateless by design: nothing is remembered between messages, which is what
 * revision 2026-07-28 requires and what earlier revisions tolerate.
 */
export async function handleMessage(msg, ctx = {}) {
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0') {
    return failure(null, ERR.INVALID_REQUEST, 'expected a JSON-RPC 2.0 message object')
  }

  const { id, method } = msg
  const isNotification = id === undefined || id === null

  if (typeof method !== 'string') {
    return isNotification ? null : failure(id, ERR.INVALID_REQUEST, 'missing method')
  }

  // Notifications are one-way; the receiver must not respond, including to
  // notifications it does not recognize.
  if (isNotification) return null

  const version = declaredVersion(msg)
  if (version !== null && !SUPPORTED_VERSIONS.includes(version)) {
    return failure(id, ERR.UNSUPPORTED_PROTOCOL_VERSION, 'Unsupported protocol version', {
      supported: SUPPORTED_VERSIONS,
      requested: version,
    })
  }
  const modern = version !== null && MODERN_VERSIONS.includes(version)

  switch (method) {
    case 'initialize':
      return handleInitialize(id, msg)
    case 'server/discover':
      return result(id, {
        supportedVersions: SUPPORTED_VERSIONS,
        capabilities: CAPABILITIES,
        instructions: INSTRUCTIONS,
        _meta: { [META_SERVER_INFO]: SERVER_INFO },
      }, true)
    case 'ping':
      return result(id, {}, modern)
    case 'tools/list':
      return result(id, { tools: toolDescriptors().map(t => ({ ...t, outputSchema: ENVELOPE_OUTPUT_SCHEMA })), nextCursor: null }, modern)
    case 'tools/call':
      return handleToolCall(id, msg, modern, ctx)
    default:
      return failure(id, ERR.METHOD_NOT_FOUND, `unknown method: ${method}`)
  }
}

function handleInitialize(id, msg) {
  const requested = msg?.params?.protocolVersion
  // Echo the client's revision when we implement it; otherwise answer with our
  // preferred one and let the client decide whether it can proceed.
  const agreed = typeof requested === 'string' && LEGACY_VERSIONS.includes(requested) ? requested : PREFERRED_LEGACY
  return result(id, {
    protocolVersion: agreed,
    capabilities: CAPABILITIES,
    serverInfo: SERVER_INFO,
    instructions: INSTRUCTIONS,
  }, false)
}

async function handleToolCall(id, msg, modern, ctx) {
  const name = msg?.params?.name
  const args = msg?.params?.arguments ?? {}

  const tool = typeof name === 'string' ? TOOLS_BY_NAME.get(name) : undefined
  if (!tool) {
    return failure(id, ERR.INVALID_PARAMS, `unknown tool: ${name}`, { available: [...TOOLS_BY_NAME.keys()] })
  }
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return failure(id, ERR.INVALID_PARAMS, 'arguments must be an object')
  }

  const env = ctx.env ?? process.env
  const toolCtx = { env, base: apiBase(env), fetchImpl: ctx.fetchImpl }

  try {
    const payload = await tool.handler(args, toolCtx)
    return result(id, {
      content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
      isError: false,
    }, modern)
  } catch (err) {
    // Tool failures belong in the result with isError, not in a JSON-RPC
    // error: the model should see what went wrong and be able to act on it.
    const message = err instanceof ApiError
      ? [err.message, err.hint].filter(Boolean).join(' ')
      : `alphalens tool failed: ${err?.message ?? err}`
    return result(id, { content: [{ type: 'text', text: message }], isError: true }, modern)
  }
}

/* ------------------------------------------------------- stdio line reader */

/**
 * Run the stdio transport: one newline-delimited JSON-RPC message per line in
 * and out. Nothing but MCP messages may go to stdout — logs go to stderr.
 */
export function runStdio({ input = process.stdin, output = process.stdout, log = console.error, ctx = {} } = {}) {
  let buffer = ''
  // Serialize handling so responses are written in the order requests arrived
  // and two handlers can never interleave a partial line onto stdout.
  let chain = Promise.resolve()

  const write = obj => {
    output.write(JSON.stringify(obj) + '\n')
  }

  const dispatch = line => {
    chain = chain.then(async () => {
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        write(failure(null, ERR.PARSE, 'invalid JSON'))
        return
      }
      try {
        const response = await handleMessage(msg, ctx)
        if (response) write(response)
      } catch (err) {
        log(`[alphalens-mcp] unhandled error: ${err?.stack ?? err}`)
        const id = msg && typeof msg === 'object' ? (msg.id ?? null) : null
        if (id !== null) write(failure(id, ERR.INTERNAL, 'internal error'))
      }
    })
  }

  input.setEncoding('utf8')
  input.on('data', chunk => {
    buffer += chunk
    let nl
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (line) dispatch(line)
    }
  })

  // Closed stdin is the portable graceful-shutdown signal. Nothing here holds
  // the event loop open once the last in-flight message has been answered and
  // stdout has drained, so let the process end on its own rather than calling
  // process.exit — an abrupt exit can truncate a response still buffered in a
  // pipe, which the client would see as a dropped reply.
  input.on('end', () => {
    chain.then(() => {
      process.exitCode = 0
    })
  })

  return { done: () => chain }
}
