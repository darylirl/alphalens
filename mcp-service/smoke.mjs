#!/usr/bin/env node
/**
 * End-to-end smoke test: launch the MCP server exactly as a client would (as a
 * subprocess over stdio), complete the handshake, and call all four tools
 * against a live AlphaLens deployment — production by default.
 *
 *   node mcp-service/smoke.mjs
 *   ALPHALENS_API_BASE=https://staging.example node mcp-service/smoke.mjs
 *
 * Exits 0 only if every tool returned a well-formed envelope. This does not
 * assert particular values — the whole point of the project is that the data
 * is whatever was really measured — but it does assert the invariants that
 * make a value trustworthy: the envelope is present, coverage is stated, the
 * notice is attached, and the tool did not report an error.
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { NOTICE } from './lib/notice.mjs'
import { LEDGER_KINDS } from './lib/tools.mjs'
import { apiBase } from './lib/api.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROTOCOL_VERSION = '2025-06-18'
const BASE = apiBase()

/* ------------------------------------------------------- stdio MCP client */

function connect() {
  const child = spawn(process.execPath, [join(HERE, 'index.mjs')], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: process.env,
  })

  const pending = new Map()
  createInterface({ input: child.stdout }).on('line', line => {
    if (!line.trim()) return
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      throw new Error(`server wrote a non-JSON line to stdout: ${line.slice(0, 200)}`)
    }
    const waiter = pending.get(msg.id)
    if (waiter) {
      pending.delete(msg.id)
      waiter(msg)
    }
  })

  let nextId = 1
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, resolve)
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`${method} timed out after 30s`))
      }, 30_000).unref()
    })

  const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')

  return { child, request, notify, close: () => child.stdin.end() }
}

/* ------------------------------------------------------------- assertions */

let failures = 0
const results = []

function check(label, ok, detail = '') {
  results.push({ label, ok, detail })
  if (!ok) failures++
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ''}`)
}

/** Every tool must return the same envelope, whatever its data looks like. */
function checkEnvelope(toolName, response) {
  if (response.error) {
    check(`${toolName} returned a result`, false, `JSON-RPC error ${response.error.code}: ${response.error.message}`)
    return null
  }
  const r = response.result ?? {}
  if (r.isError) {
    const text = r.content?.[0]?.text ?? '(no detail)'
    check(`${toolName} succeeded`, false, text)
    return null
  }

  const payload = r.structuredContent
  check(`${toolName} succeeded`, true)
  check(`${toolName} returned structuredContent`, payload != null && typeof payload === 'object')
  if (!payload) return null

  check(`${toolName} carries data`, 'data' in payload)
  check(`${toolName} carries coverage`, payload.coverage != null && typeof payload.coverage === 'object')
  check(`${toolName} carries caveats`, Array.isArray(payload.caveats) && payload.caveats.length > 0)
  check(`${toolName} carries the notice`, payload.notice === NOTICE)
  check(`${toolName} names its source endpoint`, typeof payload.source === 'string' && payload.source.startsWith(BASE))
  check(
    `${toolName} text content mirrors the structured payload`,
    r.content?.[0]?.type === 'text' && r.content[0].text.includes('"notice"')
  )
  return payload
}

/* ------------------------------------------------------------------- run */

async function main() {
  console.log(`AlphaLens MCP smoke test`)
  console.log(`  target: ${BASE}`)
  console.log(`  server: ${join(HERE, 'index.mjs')}\n`)

  const mcp = connect()

  console.log('handshake')
  const init = await mcp.request('initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'alphalens-smoke', version: '0.1.0' },
  })
  check('initialize negotiated a protocol version', init.result?.protocolVersion === PROTOCOL_VERSION, init.result?.protocolVersion)
  check('initialize advertised the tools capability', init.result?.capabilities?.tools != null)
  mcp.notify('notifications/initialized', {})

  const listed = await mcp.request('tools/list', {})
  const names = (listed.result?.tools ?? []).map(t => t.name).sort()
  const expected = [
    'alphalens_get_cohort',
    'alphalens_get_ledger_call',
    'alphalens_get_pulse',
    'alphalens_list_ledger_calls',
  ]
  check('tools/list advertises exactly the four v0 tools', JSON.stringify(names) === JSON.stringify(expected), names.join(', '))
  check(
    'every tool is annotated read-only',
    (listed.result?.tools ?? []).every(t => t.annotations?.readOnlyHint === true)
  )

  console.log('\nalphalens_get_pulse')
  const pulse = checkEnvelope('get_pulse', await mcp.request('tools/call', { name: 'alphalens_get_pulse', arguments: {} }))
  if (pulse) {
    check('pulse states a coverage status', ['live', 'stale', 'unavailable'].includes(pulse.coverage.status), pulse.coverage.status)
    check('pulse returned coin rows', Array.isArray(pulse.data.coins), `${pulse.data.coins?.length ?? 0} coins`)
    // The invariant that matters most: an empty aggregate must be labelled as
    // an outage, never served as a quiet cohort.
    check(
      'an empty aggregate is labelled unavailable rather than served as zero',
      pulse.data.coins.length > 0 || pulse.coverage.status === 'unavailable'
    )
  }

  console.log('\nalphalens_list_ledger_calls')
  const list = checkEnvelope('list_ledger_calls', await mcp.request('tools/call', {
    name: 'alphalens_list_ledger_calls',
    arguments: { limit: 5 },
  }))
  let sampleId = null
  if (list) {
    check('the call list is an array', Array.isArray(list.data.calls), `${list.data.calls?.length ?? 0} calls`)
    check('the list respected the requested limit', (list.data.calls?.length ?? 0) <= 5)
    check('coverage reports resolved/unresolved counts', typeof list.coverage.calls_returned === 'number')
    sampleId = list.data.calls?.[0]?.id ?? null
  }

  // Probe the filter with a kind the unfiltered sample does NOT contain where
  // possible. Filtering for the kind everything already is would pass whether
  // or not the deployment implements ?kind=, which is not a test.
  const seenKinds = new Set((list?.data.calls ?? []).map(c => c.kind))
  const probeKind = LEDGER_KINDS.find(k => !seenKinds.has(k)) ?? LEDGER_KINDS[0]
  console.log(`\nalphalens_list_ledger_calls (kind filter, probing "${probeKind}")`)
  const filtered = checkEnvelope('list_ledger_calls[kind]', await mcp.request('tools/call', {
    name: 'alphalens_list_ledger_calls',
    arguments: { kind: probeKind, limit: 5 },
  }))
  if (filtered) {
    check(
      'every returned call matches the requested kind',
      (filtered.data.calls ?? []).every(c => c.kind === probeKind)
    )
    check(
      'the deployment applied the kind filter server-side',
      filtered.coverage.server_side_kind_filter === true,
      filtered.coverage.server_side_kind_filter === false
        ? 'upstream ignored ?kind= — this deployment predates the parameter'
        : ''
    )
  }

  console.log('\nalphalens_get_ledger_call')
  if (sampleId === null) {
    check('a call id was available to fetch', false, 'the list returned no calls to drill into')
  } else {
    const detail = checkEnvelope('get_ledger_call', await mcp.request('tools/call', {
      name: 'alphalens_get_ledger_call',
      arguments: { id: sampleId },
    }))
    if (detail) {
      check('the detail is the call that was requested', detail.data.call?.id === sampleId, `id ${sampleId}`)
      check('the call carries provenance', detail.data.call?.provenance != null && typeof detail.data.call.provenance === 'object')
      check('the call carries a permalink', typeof detail.data.call?.permalink === 'string')
    }
  }

  console.log('\nalphalens_get_cohort')
  const cohort = checkEnvelope('get_cohort', await mcp.request('tools/call', {
    name: 'alphalens_get_cohort',
    arguments: {},
  }))
  if (cohort) {
    check('the cohort count is a number', Number.isInteger(cohort.data.count), String(cohort.data.count))
    check('the archetype breakdown is present', Array.isArray(cohort.data.by_archetype) && cohort.data.by_archetype.length > 0)
    check('selection criteria are included', Array.isArray(cohort.data.selection?.criteria) && cohort.data.selection.criteria.length > 0)
    check('the CSV download URL is included', typeof cohort.data.snapshot?.csv_url === 'string')
    check(
      'the CSV SHA-256 is included',
      typeof cohort.data.snapshot?.csv_sha256 === 'string' && /^[0-9a-f]{64}$/.test(cohort.data.snapshot.csv_sha256),
      cohort.data.snapshot?.csv_sha256
    )
    check(
      'the archetype counts sum to the cohort count',
      cohort.data.by_archetype.reduce((n, a) => n + a.count, 0) === cohort.data.count
    )
  }

  console.log('\nerror handling')
  const missing = await mcp.request('tools/call', { name: 'alphalens_get_ledger_call', arguments: { id: 999999999 } })
  check(
    'a missing call is an actionable tool error, not a fabricated answer',
    missing.result?.isError === true && /404/.test(missing.result?.content?.[0]?.text ?? '')
  )
  const unknown = await mcp.request('tools/call', { name: 'alphalens_nope', arguments: {} })
  check('an unknown tool is rejected with invalid-params', unknown.error?.code === -32602)

  mcp.close()

  const total = results.length
  console.log(`\n${total - failures}/${total} checks passed against ${BASE}`)
  if (failures > 0) {
    console.log('\nfailed checks:')
    for (const r of results.filter(r => !r.ok)) console.log(`  - ${r.label}${r.detail ? ` — ${r.detail}` : ''}`)
  }
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(err => {
  console.error(`\nsmoke test aborted: ${err?.stack ?? err}`)
  process.exit(1)
})
