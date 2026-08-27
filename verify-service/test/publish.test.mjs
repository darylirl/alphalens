import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cohortSignalCall,
  ledgerEligibility,
  ledgerEligibleOnly,
  publishCohortSignal,
  publishResult,
} from '../lib/publish.mjs'
import { scoreableSubject } from '../lib/scorer.mjs'

const conformingSpec = {
  spec_version: 1,
  hypothesis_text: 'Cohort net flow flipping positive precedes higher BTC.',
  universe: { coins: ['BTC'] },
  entry: { side: 'long', rule: { type: 'cohort', metric: 'net_flow_usd', op: 'cross_above', value: 0 } },
  exit: { condition: null, max_holding_time_h: 24 },
  sizing: { mode: 'fixed_usd', notional_usd: 1000 },
  frictions: { delay_s: 60, slippage_bps: 5, taker_fee_pct: 0.045 },
  window: { start: '2026-06-17T00:00:00Z', end: '2026-08-16T00:00:00Z' },
  kill_criteria: [{ id: 'unprofitable', metric: 'net_pnl_usd', op: 'lte', value: 0 }],
  notes: { look_ahead_flags: [], mechanism: 'pattern_based' },
}

test('a canonical-engine result with a conforming spec is Ledger-eligible', () => {
  const { eligible, reasons } = ledgerEligibility({
    engine_version: 'verify-engine@1.0.0', spec: conformingSpec,
  })
  assert.equal(eligible, true)
  assert.deepEqual(reasons, [])
})

test('a result from another engine is not eligible, and says why', () => {
  const { eligible, reasons } = ledgerEligibility({
    engine_version: 'e2e-runner-0.1.0', spec: conformingSpec,
  })
  assert.equal(eligible, false)
  assert.match(reasons[0], /not the canonical engine/)
})

test('a canonical result whose spec predates the grammar is not eligible', () => {
  // The shape verification_results id=1 actually carries.
  const legacy = {
    ...conformingSpec,
    entry: { side: 'long', type: 'cross_above', series: 'cohort.net_flow_usd', window: '24h', threshold: 0 },
  }
  const { eligible, reasons } = ledgerEligibility({ engine_version: 'verify-engine@1.0.0', spec: legacy })
  assert.equal(eligible, false)
  assert.match(reasons[0], /does not conform to the current grammar/)
})

test('both failures are reported together, not one at a time', () => {
  const { reasons } = ledgerEligibility({ engine_version: 'e2e-runner-0.1.0', spec: { nonsense: true } })
  assert.equal(reasons.length, 2)
})

test('an under-frictioned spec can never be Ledger-eligible', () => {
  const cheat = { ...conformingSpec, frictions: { delay_s: 30, slippage_bps: 2, taker_fee_pct: 0.01 } }
  assert.equal(ledgerEligibility({ engine_version: 'verify-engine@1.0.0', spec: cheat }).eligible, false)
})

test('same spec, two results, one Ledger call (dedup by spec_hash)', async () => {
  // In-memory ledger_calls standing in for PostgREST: answers the dedup
  // lookup and records inserts.
  const calls = []
  const db = async (pathQs, { method = 'GET', body } = {}) => {
    if (method === 'POST') {
      const row = { id: calls.length + 1, ...body[0] }
      calls.push(row)
      return [row]
    }
    const hash = /provenance->>spec_hash=eq\.([0-9a-f]+)/.exec(pathQs)?.[1]
    return calls.filter((c) => c.kind === 'hypothesis_verdict' && c.provenance?.spec_hash === hash)
  }

  const sharedHash = 'b'.repeat(64)
  const base = {
    engine_version: 'verify-engine@1.0.0',
    spec: conformingSpec,
    spec_hash: sharedHash,
    trade_count: 35,
    metrics: { net_pnl_usd: -66.546151 },
    verdict: { overall: 'killed' },
  }
  const logs = []
  const log = (m) => logs.push(m)

  // First result of the spec publishes.
  const first = await publishResult({ ...base, id: 41, job_id: 8 }, { log, db })
  assert.equal(first.published, true)
  assert.equal(calls.length, 1)

  // A re-run of the SAME spec (new result id, new job) is skipped, logging
  // the existing call id — reproduction is evidence, not a second call.
  const second = await publishResult({ ...base, id: 42, job_id: 9 }, { log, db })
  assert.equal(second.published, false)
  assert.match(second.reasons[0], /already published as call 1/)
  assert.equal(calls.length, 1, 'the ledger must hold exactly one call for the spec')
  assert.ok(logs.some((m) => /call 1/.test(m) && /dedup by spec_hash/.test(m)),
    'the skip is logged with the existing call id')
})

test('filtering keeps eligible rows and drops the rest without mutating them', () => {
  const rows = [
    { id: 1, engine_version: 'e2e-runner-0.1.0', spec: conformingSpec },
    { id: 2, engine_version: 'verify-engine@1.0.0', spec: conformingSpec },
  ]
  assert.deepEqual(ledgerEligibleOnly(rows).map((r) => r.id), [2])
  assert.equal(rows.length, 2, 'filtering must not delete history')
})

// ── cohort_signal: the forward-looking path ─────────────────────────────────

// The base fixture is HYPE's real skew reading with a CONSTRUCTED concentration
// block: twelve wallets on the short side, the largest holding 28% of it. The
// real HYPE book was not spread like this — seven wallets, one holding about
// two thirds — and that reading is pinned as a refusal further down. The
// counterfactual exists so the rest of the happy path stays exercisable; it is
// never presented as a measurement.
const CONCENTRATION_OK = {
  long: { notionalUsd: 729_902, wallets: 11, topWalletNotionalUsd: 160_578 },
  short: { notionalUsd: 3_344_730, wallets: 12, topWalletNotionalUsd: 936_524 }, // 28.0%
}

const snapshot = {
  coin: 'HYPE',
  notionalUsd: 4_074_632,
  netFlowUsd: -2_614_827,
  longPct: 18,
  longPctChange: -14,
  activeWallets: 7,
  computedAt: '2026-08-27T17:00:00.000Z',
  coverage: { live: true, computedAt: '2026-08-27T17:00:00.000Z' },
  concentration: CONCENTRATION_OK,
}

const signalInput = {
  coin: 'HYPE',
  direction: 'down',
  confidence: 0.55,
  publishedAt: '2026-08-27T18:00:00.000Z',
  horizonHours: 24,
  snapshot,
}

test('a cohort_signal call is coin-level, scoreable, and resolves at the horizon', () => {
  const row = cohortSignalCall(signalInput)
  assert.equal(row.kind, 'cohort_signal')
  assert.deepEqual(row.subject, { scope: 'cohort', coin: 'HYPE', direction: 'down' })
  assert.equal(scoreableSubject(row.subject).ok, true)
  assert.equal(row.resolves_at, '2026-08-28T18:00:00.000Z')
  assert.equal(row.horizon_hours, 24)
  assert.equal(row.confidence, 0.55)
})

test('no per-wallet signals: the subject carries no wallet key of any spelling', () => {
  const row = cohortSignalCall(signalInput)
  for (const k of ['wallet', 'wallet_address', 'address']) {
    assert.equal(Object.hasOwn(row.subject, k), false, `subject must not carry ${k}`)
  }
})

test('the claim names the direction, the horizon and both resolution instants', () => {
  const { claim } = cohortSignalCall(signalInput)
  assert.match(claim, /HYPE is strictly lower 24h from publication/)
  assert.ok(claim.includes('2026-08-27T18:00:00.000Z'), 'claim states the entry instant')
  assert.ok(claim.includes('2026-08-28T18:00:00.000Z'), 'claim states the resolution instant')
  // The tie and the gap are stated, because the scorer treats them differently
  // and a reader must not have to guess which.
  assert.match(claim, /equal prices resolve INCORRECT/)
  assert.match(claim, /UNRESOLVABLE with no Brier score/)
})

test('provenance records the snapshot the call was derived from', () => {
  const { provenance } = cohortSignalCall(signalInput)
  assert.equal(provenance.snapshot.computed_at, '2026-08-27T17:00:00.000Z')
  assert.equal(provenance.snapshot.active_wallets, 7)
  assert.equal(provenance.snapshot.notional_usd, 4_074_632)
  assert.equal(provenance.snapshot.net_flow_usd, -2_614_827)
  assert.ok(provenance.engine.length > 0, 'ledger_provenance_ok requires a non-empty engine')
})

test('a call cannot point the opposite way to its own snapshot', () => {
  assert.throws(
    () => cohortSignalCall({ ...signalInput, direction: 'up' }),
    /contradicts the snapshot/,
  )
})

test('a balanced book is not a directional call', () => {
  // BTC as the live pulse actually reads it: broad, huge, and 0.5% skewed.
  const btc = {
    ...snapshot, coin: 'BTC', netFlowUsd: 2_893_665, notionalUsd: 596_584_598, activeWallets: 52, longPct: 50,
  }
  assert.throws(
    () => cohortSignalCall({ ...signalInput, coin: 'BTC', direction: 'up', snapshot: btc }),
    /under the 5% floor/,
  )
})

test('one or two wallets are a position, not a cohort', () => {
  const thin = { ...snapshot, coin: 'xyz:ARM', netFlowUsd: -528_780, notionalUsd: 548_640, activeWallets: 1 }
  assert.throws(
    () => cohortSignalCall({ ...signalInput, coin: 'xyz:ARM', snapshot: thin }),
    /under the 3 floor/,
  )
})

test('an unrecorded snapshot is unpublishable — provenance cannot be retrofitted', () => {
  const { computedAt, ...noRefreshTime } = snapshot
  assert.throws(
    () => cohortSignalCall({ ...signalInput, snapshot: { ...noRefreshTime, computedAt: null } }),
    /matview refresh time is required/,
  )
})

test('confidence must be a probability, never a certainty', () => {
  for (const c of [0, 1, 1.5, -0.2, NaN]) {
    assert.throws(() => cohortSignalCall({ ...signalInput, confidence: c }), /confidence/)
  }
})

test('one snapshot, one call: republishing the same reading is a no-op', async () => {
  const calls = []
  const db = async (pathQs, { method = 'GET', body } = {}) => {
    if (method === 'POST') {
      const row = { id: calls.length + 1, ...body[0] }
      calls.push(row)
      return [row]
    }
    const at = decodeURIComponent(
      /provenance->snapshot->>computed_at=eq\.([^&]+)/.exec(pathQs)?.[1] ?? '',
    )
    const coin = decodeURIComponent(/subject->>coin=eq\.([^&]+)/.exec(pathQs)?.[1] ?? '')
    return calls.filter((c) => c.subject?.coin === coin && c.provenance?.snapshot?.computed_at === at)
  }

  const logs = []
  const log = (m) => logs.push(m)
  const first = await publishCohortSignal(signalInput, { db, log })
  assert.equal(first.published, true)

  // Same snapshot, a later publish attempt: the matview has not refreshed, so
  // there is no new reading and there must be no second call.
  const second = await publishCohortSignal(
    { ...signalInput, publishedAt: '2026-08-27T18:30:00.000Z' }, { db, log },
  )
  assert.equal(second.published, false)
  assert.equal(calls.length, 1)
  assert.match(second.reasons[0], /already published as call 1/)
})

// ── concentration floors (pre-registered 2026-08-27) ────────────────────────

test('the real HYPE reading is refused: seven wallets, one holding two thirds', () => {
  // The measurement that motivated the floor. Skew -64.2%, notional $4.07M and
  // 7 active wallets all cleared; concentration is the only thing that catches
  // it, and it must.
  const real = {
    ...snapshot,
    concentration: {
      long: { notionalUsd: 729_902, wallets: 4, topWalletNotionalUsd: 210_000 },
      short: { notionalUsd: 3_344_730, wallets: 7, topWalletNotionalUsd: 2_223_000 }, // 66.5%
    },
  }
  assert.throws(
    () => cohortSignalCall({ ...signalInput, snapshot: real }),
    (e) => /66\.5% of the .* directed short/.test(e.message)
      && /over the 40% ceiling/.test(e.message)
      && /7 wallet\(s\) traded HYPE short/.test(e.message)
      && /under the 10 floor/.test(e.message),
  )
})

test('an unmeasured concentration is refused, never read as uncontested', () => {
  const { concentration, ...noBlock } = snapshot
  assert.throws(
    () => cohortSignalCall({ ...signalInput, snapshot: noBlock }),
    /no concentration block .* predates migration 024[\s\S]*unmeasured, which is not the same as/,
  )
})

test('a direction with no notional behind it is unmeasured, not 0% concentrated', () => {
  const empty = {
    ...snapshot,
    concentration: { ...CONCENTRATION_OK, short: { notionalUsd: 0, wallets: 0, topWalletNotionalUsd: 0 } },
  }
  assert.throws(
    () => cohortSignalCall({ ...signalInput, snapshot: empty }),
    /no notional was directed short in the window/,
  )
})

test('the floor reads the CALLED direction, not the busy other side of the book', () => {
  // A crowded long side does not make a concentrated short call honest.
  const lopsided = {
    ...snapshot,
    concentration: {
      long: { notionalUsd: 5_000_000, wallets: 50, topWalletNotionalUsd: 100_000 },  // spotless
      short: { notionalUsd: 3_344_730, wallets: 12, topWalletNotionalUsd: 2_000_000 }, // 59.8%
    },
  }
  assert.throws(
    () => cohortSignalCall({ ...signalInput, snapshot: lopsided }),
    /59\.8% of the .* directed short/,
  )
})

test('the floors are boundaries, not preferences: exactly 10 wallets and exactly 40% pass', () => {
  const onTheLine = {
    ...snapshot,
    concentration: {
      ...CONCENTRATION_OK,
      short: { notionalUsd: 3_000_000, wallets: 10, topWalletNotionalUsd: 1_200_000 }, // exactly 40.0%
    },
  }
  const row = cohortSignalCall({ ...signalInput, snapshot: onTheLine })
  assert.equal(row.provenance.snapshot.top_wallet_share_pct, 40)
  assert.equal(row.provenance.snapshot.participating_wallets, 10)

  const justOver = {
    ...snapshot,
    concentration: {
      ...CONCENTRATION_OK,
      short: { notionalUsd: 3_000_000, wallets: 10, topWalletNotionalUsd: 1_200_001 },
    },
  }
  assert.throws(() => cohortSignalCall({ ...signalInput, snapshot: justOver }), /over the 40% ceiling/)

  const oneShort = {
    ...snapshot,
    concentration: { ...CONCENTRATION_OK, short: { notionalUsd: 3_000_000, wallets: 9, topWalletNotionalUsd: 900_000 } },
  }
  assert.throws(() => cohortSignalCall({ ...signalInput, snapshot: oneShort }), /9 wallet\(s\).*under the 10 floor/)
})

test('provenance records the concentration reading and the floors it was cleared against', () => {
  const { provenance } = cohortSignalCall(signalInput)
  assert.equal(provenance.snapshot.participating_wallets, 12)
  assert.equal(provenance.snapshot.directional_notional_usd, 3_344_730)
  assert.equal(provenance.snapshot.top_wallet_notional_usd, 936_524)
  assert.equal(provenance.snapshot.top_wallet_share_pct, 28)
  assert.equal(provenance.floors.max_wallet_concentration_pct, 40)
  assert.equal(provenance.floors.min_participating_wallets, 10)
})

test('the claim states the concentration, so a reader can check the floor themselves', () => {
  const { claim } = cohortSignalCall(signalInput)
  assert.match(claim, /spread across 12 wallets trading that side with the largest holding 28\.0% of it\./)
})
