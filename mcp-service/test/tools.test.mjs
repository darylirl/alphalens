/**
 * Tool tests against a stubbed HTTP layer. The point is not to check that the
 * production API works — smoke.mjs does that against the real deployment —
 * but to pin the behaviours that must hold whatever the API returns:
 *
 *   - a gap is never rendered as a zero,
 *   - an outage is never rendered as an empty result,
 *   - the notice and coverage block travel with every answer.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { handleMessage } from '../lib/server.mjs'
import { NOTICE } from '../lib/notice.mjs'

const BASE = 'https://alphalens.test'

/** Stub fetch: routes are matched by pathname + search. */
function stubFetch(routes) {
  const calls = []
  const impl = async url => {
    const u = new URL(url)
    calls.push(u.pathname + u.search)
    const route = routes[u.pathname]
    const resolved = typeof route === 'function' ? route(u) : route
    if (!resolved) return new Response('not found', { status: 404 })
    const { status = 200, body } = resolved
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }
  impl.calls = calls
  return impl
}

async function call(name, args, routes) {
  const res = await handleMessage(
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    { env: { ALPHALENS_API_BASE: BASE }, fetchImpl: stubFetch(routes) }
  )
  return res.result
}

const PULSE_OK = {
  coins: [{ coin: 'BTC', notionalUsd: 100, netFlowUsd: -5, longPct: 49, longPctChange: null, notionalChangePct: null, newLongs: 2, newShorts: 3, newNotionalUsd: 10, addNotionalUsd: 20, activeWallets: 7 }],
  coverage: { live: true, captureSince: '2026-08-16T06:10:07Z', lastHeartbeat: '2026-08-25T16:55:39Z', walletsTracked: 176, computedAt: '2026-08-25T16:35:00Z' },
}

/* ------------------------------------------------------------------ pulse */

test('pulse passes through the served numbers and the coverage block', async () => {
  const r = await call('alphalens_get_pulse', {}, { '/api/pulse': { body: PULSE_OK } })
  assert.equal(r.isError, false)
  const p = r.structuredContent
  assert.equal(p.data.coins[0].coin, 'BTC')
  assert.equal(p.data.coins[0].net_flow_usd, -5)
  assert.equal(p.coverage.status, 'live')
  assert.equal(p.coverage.wallets_tracked, 176)
  assert.equal(p.notice, NOTICE)
  assert.equal(p.source, `${BASE}/api/pulse`)
})

test('a null change field stays null — it means no baseline, not no change', async () => {
  const r = await call('alphalens_get_pulse', {}, { '/api/pulse': { body: PULSE_OK } })
  assert.equal(r.structuredContent.data.coins[0].long_pct_change, null)
  assert.equal(r.structuredContent.data.coins[0].notional_change_pct, null)
})

test('an empty pulse with no coverage metadata is labelled unavailable, not quiet', async () => {
  const empty = { coins: [], coverage: { live: false, captureSince: null, lastHeartbeat: null, walletsTracked: null, computedAt: null } }
  const r = await call('alphalens_get_pulse', {}, { '/api/pulse': { body: empty } })
  const p = r.structuredContent
  assert.equal(p.coverage.status, 'unavailable')
  assert.match(p.caveats[0], /NO MEASUREMENT AVAILABLE/)
  assert.match(p.caveats[0], /not.*"the cohort is flat"/i)
})

test('a stale but populated pulse says the trailing edge may be incomplete', async () => {
  const stale = { ...PULSE_OK, coverage: { ...PULSE_OK.coverage, live: false } }
  const r = await call('alphalens_get_pulse', {}, { '/api/pulse': { body: stale } })
  assert.equal(r.structuredContent.coverage.status, 'stale')
  assert.match(r.structuredContent.caveats[0], /not currently reporting/)
})

test('a 503 from the API is an error, never an empty answer', async () => {
  const r = await call('alphalens_get_pulse', {}, { '/api/pulse': { status: 503, body: { error: 'unavailable' } } })
  assert.equal(r.isError, true)
  assert.match(r.content[0].text, /503/)
  assert.match(r.content[0].text, /outage, not an empty result/)
})

/* ----------------------------------------------------------- ledger calls */

const CALL_A = { id: 5, kind: 'hypothesis_verdict', claim: 'KILLED', provenance: { engine: 'verify-engine@1.0.0' }, resolved_at: null, resolves_at: null, outcome: null, scored_brier: null, permalink: `${BASE}/ledger/5` }
const CALL_B = { id: 4, kind: 'cohort_signal', claim: 'signal', provenance: {}, resolved_at: '2026-08-20T00:00:00Z', resolves_at: '2026-08-20T00:00:00Z', outcome: 'unresolvable', scored_brier: null, permalink: `${BASE}/ledger/4` }

test('the kind parameter is forwarded to the API as a query parameter', async () => {
  const fetchImpl = stubFetch({ '/api/ledger/calls': { body: { schema: 'ledger.v0', kind: 'cohort_signal', calls: [CALL_B], next_cursor: null } } })
  await handleMessage(
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'alphalens_list_ledger_calls', arguments: { kind: 'cohort_signal', limit: 10 } } },
    { env: { ALPHALENS_API_BASE: BASE }, fetchImpl }
  )
  assert.equal(fetchImpl.calls[0], '/api/ledger/calls?kind=cohort_signal&limit=10')
})

test('a deployment that ignores the kind filter cannot leak the wrong kind through', async () => {
  // An older deployment answers ?kind= by returning everything. The tool must
  // not hand that back as a filtered list.
  const r = await call('alphalens_list_ledger_calls', { kind: 'cohort_signal' }, {
    '/api/ledger/calls': { body: { schema: 'ledger.v0', calls: [CALL_A, CALL_B], next_cursor: null } },
  })
  const p = r.structuredContent
  assert.deepEqual(p.data.calls.map(c => c.id), [4])
  assert.equal(p.coverage.server_side_kind_filter, false)
  assert.match(p.caveats[0], /did not apply the kind filter server-side/)
})

test('coverage counts resolved and unresolved calls separately', async () => {
  const r = await call('alphalens_list_ledger_calls', {}, {
    '/api/ledger/calls': { body: { schema: 'ledger.v0', calls: [CALL_A, CALL_B], next_cursor: 'abc' } },
  })
  const p = r.structuredContent
  assert.equal(p.coverage.calls_returned, 2)
  assert.equal(p.coverage.resolved, 1)
  assert.equal(p.coverage.unresolved, 1)
  assert.equal(p.coverage.has_more, true)
  assert.equal(p.data.next_cursor, 'abc')
})

test('bad arguments are rejected before any request is made', async () => {
  const fetchImpl = stubFetch({})
  const res = await handleMessage(
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'alphalens_list_ledger_calls', arguments: { limit: 0 } } },
    { env: { ALPHALENS_API_BASE: BASE }, fetchImpl }
  )
  assert.equal(res.result.isError, true)
  assert.match(res.result.content[0].text, /limit must be an integer/)
  assert.equal(fetchImpl.calls.length, 0)
})

test('an unresolvable call is explained as a tape gap, not as a miss', async () => {
  const r = await call('alphalens_get_ledger_call', { id: 4 }, {
    '/api/ledger/calls/4': { body: { schema: 'ledger.v0', call: CALL_B } },
  })
  const p = r.structuredContent
  assert.equal(p.coverage.outcome, 'unresolvable')
  assert.equal(p.coverage.scored_brier, null)
  assert.ok(p.caveats.some(c => /no price was assumed and no Brier score/.test(c)))
})

test('a 404 for a missing call points the caller back at the list', async () => {
  const r = await call('alphalens_get_ledger_call', { id: 99 }, {})
  assert.equal(r.isError, true)
  assert.match(r.content[0].text, /404/)
  assert.match(r.content[0].text, /list calls first/i)
})

/* ----------------------------------------------------------------- cohort */

const COHORT = {
  schema: 'cohort.v0',
  count: 176,
  by_archetype: [{ archetype: 'swing_trader', count: 100 }, { archetype: 'scalper', count: 76 }],
  selection: { criteria: ['classified by observed behavior'], page_url: `${BASE}/cohort` },
  snapshot: { csv_url: `${BASE}/api/cohort/csv`, csv_sha256: 'a'.repeat(64), csv_columns: ['address', 'archetype', 'added_at'] },
  wallets: [{ address: '0x' + '1'.repeat(40), archetype: 'scalper', trade_count_30d: null, added_at: '2026-08-01T00:00:00Z' }],
  next_cursor: null,
}

test('the cohort summary carries counts, criteria and the hashed CSV', async () => {
  const r = await call('alphalens_get_cohort', {}, { '/api/cohort': { body: COHORT } })
  const p = r.structuredContent
  assert.equal(p.data.count, 176)
  assert.equal(p.data.by_archetype.length, 2)
  assert.equal(p.data.snapshot.csv_sha256.length, 64)
  assert.ok(p.data.selection.criteria.length > 0)
  // Addresses are opt-in: a summary request must not drag the whole list along.
  assert.equal(p.data.wallets, null)
  assert.equal(p.coverage.wallets_included, false)
  assert.equal(p.coverage.count_is_full_cohort, true)
})

test('include_wallets asks the API for a real page instead of the 1-row probe', async () => {
  const fetchImpl = stubFetch({ '/api/cohort': { body: COHORT } })
  const summary = await handleMessage(
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'alphalens_get_cohort', arguments: {} } },
    { env: { ALPHALENS_API_BASE: BASE }, fetchImpl }
  )
  assert.equal(summary.result.isError, false)
  assert.equal(fetchImpl.calls[0], '/api/cohort?limit=1')

  await handleMessage(
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'alphalens_get_cohort', arguments: { include_wallets: true, limit: 50 } } },
    { env: { ALPHALENS_API_BASE: BASE }, fetchImpl }
  )
  assert.equal(fetchImpl.calls[1], '/api/cohort?limit=50')
})

test('the cohort answer says it is an audit list, not a list to follow', async () => {
  const r = await call('alphalens_get_cohort', {}, { '/api/cohort': { body: COHORT } })
  assert.ok(r.structuredContent.caveats.some(c => /NOT a list.*to follow/i.test(c)))
})

/* -------------------------------------------------------------- envelope */

test('every tool returns the same envelope with the notice attached', async () => {
  const routes = {
    '/api/pulse': { body: PULSE_OK },
    '/api/ledger/calls': { body: { schema: 'ledger.v0', calls: [CALL_A], next_cursor: null } },
    '/api/ledger/calls/5': { body: { schema: 'ledger.v0', call: CALL_A } },
    '/api/cohort': { body: COHORT },
  }
  const invocations = [
    ['alphalens_get_pulse', {}],
    ['alphalens_list_ledger_calls', {}],
    ['alphalens_get_ledger_call', { id: 5 }],
    ['alphalens_get_cohort', {}],
  ]
  for (const [name, args] of invocations) {
    const r = await call(name, args, routes)
    const p = r.structuredContent
    assert.equal(r.isError, false, `${name} should succeed`)
    assert.ok('data' in p, `${name} must carry data`)
    assert.equal(typeof p.coverage, 'object', `${name} must carry coverage`)
    assert.ok(p.caveats.length > 0, `${name} must carry caveats`)
    assert.equal(p.notice, NOTICE, `${name} must carry the notice`)
    assert.ok(p.source.startsWith(BASE), `${name} must name its source`)
    // The text content is what a model without structured-output support sees;
    // it must be the same payload, not a summary of it.
    assert.deepEqual(JSON.parse(r.content[0].text), p, `${name} text content must mirror structuredContent`)
  }
})
