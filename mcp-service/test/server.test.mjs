/**
 * Protocol-level tests. These run offline: no network, no deployment. They
 * check that the hand-rolled transport actually speaks MCP, in both the
 * handshake era and the per-request-metadata era.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  handleMessage,
  SUPPORTED_VERSIONS,
  MODERN_VERSIONS,
  PREFERRED_LEGACY,
  META_VERSION,
  META_SERVER_INFO,
  ERR,
} from '../lib/server.mjs'

const req = (id, method, params) => ({ jsonrpc: '2.0', id, method, params })

test('initialize echoes a legacy revision the server implements', async () => {
  const res = await handleMessage(req(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {} }))
  assert.equal(res.result.protocolVersion, '2025-03-26')
  assert.ok(res.result.capabilities.tools)
  assert.equal(res.result.serverInfo.name, 'alphalens-mcp-server')
  // Legacy results carry no resultType — that field belongs to modern results.
  assert.equal(res.result.resultType, undefined)
})

test('initialize falls back to a supported revision for an unknown one', async () => {
  const res = await handleMessage(req(1, 'initialize', { protocolVersion: '1999-01-01' }))
  assert.equal(res.result.protocolVersion, PREFERRED_LEGACY)
})

test('server/discover answers the modern probe with supported versions', async () => {
  const res = await handleMessage(req('d', 'server/discover', {}))
  assert.equal(res.result.resultType, 'complete')
  assert.deepEqual(res.result.supportedVersions, SUPPORTED_VERSIONS)
  assert.equal(res.result._meta[META_SERVER_INFO].name, 'alphalens-mcp-server')
  assert.match(res.result.instructions, /Nothing here is financial advice/i)
})

test('a request declaring an unsupported version is rejected with the versions we do speak', async () => {
  const res = await handleMessage({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: { _meta: { [META_VERSION]: '1900-01-01' } },
  })
  assert.equal(res.error.code, ERR.UNSUPPORTED_PROTOCOL_VERSION)
  assert.deepEqual(res.error.data.supported, SUPPORTED_VERSIONS)
  assert.equal(res.error.data.requested, '1900-01-01')
})

test('a modern request gets resultType on its result, a legacy one does not', async () => {
  const modern = await handleMessage({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/list',
    params: { _meta: { [META_VERSION]: MODERN_VERSIONS[0] } },
  })
  assert.equal(modern.result.resultType, 'complete')

  const legacy = await handleMessage(req(4, 'tools/list', {}))
  assert.equal(legacy.result.resultType, undefined)
  assert.ok(Array.isArray(legacy.result.tools))
})

test('tools/list advertises exactly the four read-only v0 tools', async () => {
  const res = await handleMessage(req(5, 'tools/list', {}))
  const names = res.result.tools.map(t => t.name).sort()
  assert.deepEqual(names, [
    'alphalens_get_cohort',
    'alphalens_get_ledger_call',
    'alphalens_get_pulse',
    'alphalens_list_ledger_calls',
  ])
  for (const t of res.result.tools) {
    assert.equal(t.annotations.readOnlyHint, true, `${t.name} must be annotated read-only`)
    assert.equal(t.annotations.destructiveHint, false, `${t.name} must not be annotated destructive`)
    assert.equal(t.inputSchema.type, 'object')
    assert.ok(t.outputSchema.required.includes('notice'), `${t.name} must promise the notice field`)
    assert.equal(t.handler, undefined, 'handlers must never reach the wire')
  }
})

test('notifications are never answered', async () => {
  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }), null)
  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } }), null)
  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'something/unknown' }), null)
})

test('ping is answered, unknown methods are not', async () => {
  assert.deepEqual((await handleMessage(req(6, 'ping', {}))).result, {})
  const res = await handleMessage(req(7, 'nope/nope', {}))
  assert.equal(res.error.code, ERR.METHOD_NOT_FOUND)
})

test('a malformed message is a JSON-RPC invalid-request, not a crash', async () => {
  assert.equal((await handleMessage(null)).error.code, ERR.INVALID_REQUEST)
  assert.equal((await handleMessage({ jsonrpc: '1.0', id: 1, method: 'ping' })).error.code, ERR.INVALID_REQUEST)
  assert.equal((await handleMessage({ jsonrpc: '2.0', id: 1 })).error.code, ERR.INVALID_REQUEST)
})

test('an unknown tool name is invalid-params and lists what is available', async () => {
  const res = await handleMessage(req(8, 'tools/call', { name: 'alphalens_delete_everything', arguments: {} }))
  assert.equal(res.error.code, ERR.INVALID_PARAMS)
  assert.ok(res.error.data.available.includes('alphalens_get_pulse'))
})
