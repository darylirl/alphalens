import test from 'node:test'
import assert from 'node:assert/strict'
import { hypothesisVerdictCall } from '../lib/publish.mjs'
import { adjudicate, scoreableSubject, GRACE_H } from '../lib/scorer.mjs'

const HOUR_MS = 3_600_000

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

const eligibleResult = {
  id: 5,
  job_id: 4,
  engine_version: 'verify-engine@1.0.0',
  spec: conformingSpec,
  spec_hash: 'a'.repeat(64),
  trade_count: 35,
  metrics: { net_pnl_usd: -66.546151 },
  verdict: { overall: 'killed' },
}

// ── hypothesis_verdict calls come only from the publishing rule ─────────────

test('an eligible result builds a strategy-level verdict call', () => {
  const call = hypothesisVerdictCall(eligibleResult)
  assert.equal(call.kind, 'hypothesis_verdict')
  assert.equal(call.subject.scope, 'strategy')
  assert.equal(call.subject.verdict, 'killed')
  assert.deepEqual(call.subject.coins, ['BTC'])
  assert.equal(call.confidence, null)
  assert.equal(call.resolves_at, null)
  assert.equal(call.horizon_hours, 60 * 24)  // 60-day window
  assert.deepEqual(call.provenance, {
    engine: 'verify-engine@1.0.0', spec_hash: 'a'.repeat(64), result_id: 5, job_id: 4,
  })
  assert.match(call.claim, /^KILLED: /)
  assert.match(call.claim, /35 trades, net \$-66\.55/)
})

test('no per-wallet verdicts: the subject never carries a wallet key', () => {
  const call = hypothesisVerdictCall(eligibleResult)
  for (const k of ['wallet', 'wallet_address', 'address']) {
    assert.equal(k in call.subject, false, `subject must not contain "${k}"`)
  }
})

test('an ineligible result cannot become a call at all', () => {
  assert.throws(
    () => hypothesisVerdictCall({ ...eligibleResult, engine_version: 'e2e-runner-0.1.0' }),
    /not Ledger-eligible/,
  )
  const legacySpec = {
    ...conformingSpec,
    entry: { side: 'long', type: 'cross_above', series: 'cohort.net_flow_usd' },
  }
  assert.throws(() => hypothesisVerdictCall({ ...eligibleResult, spec: legacySpec }), /not Ledger-eligible/)
})

test('a result without an adjudicated verdict cannot publish', () => {
  assert.throws(
    () => hypothesisVerdictCall({ ...eligibleResult, verdict: { overall: 'inconclusive' } }),
    /no adjudicated verdict/,
  )
})

// ── scoring: gaps are never scored, Brier is exact ──────────────────────────

const signalCall = {
  id: 9,
  kind: 'cohort_signal',
  published_at: '2026-08-20T00:00:00Z',
  resolves_at: '2026-08-21T00:00:00Z',
  confidence: 0.7,
  subject: { scope: 'cohort', coin: 'BTC', direction: 'up' },
  claim: 'BTC higher in 24h on cohort flow flip.',
}

const t = (iso) => Date.parse(iso)

test('a correct up-call scores Brier (confidence - 1)^2', () => {
  const d = adjudicate(signalCall, {
    entry: { ts: signalCall.published_at, price: 100, source: 'candles_1m' },
    exit: { ts: signalCall.resolves_at, price: 105, source: 'candles_1m' },
    nowMs: t('2026-08-21T00:05:00Z'),
  })
  assert.equal(d.action, 'resolve')
  assert.equal(d.outcome, 'correct')
  assert.ok(Math.abs(d.scored_brier - 0.09) < 1e-12)
  assert.equal(d.evidence.direction_called, 'up')
  assert.ok(Math.abs(d.evidence.move_pct - 5) < 1e-12)
})

test('an incorrect up-call (flat counts as not-up) scores (confidence - 0)^2', () => {
  const d = adjudicate(signalCall, {
    entry: { ts: signalCall.published_at, price: 100, source: 'candles_1m' },
    exit: { ts: signalCall.resolves_at, price: 100, source: 'fills' },
    nowMs: t('2026-08-21T00:05:00Z'),
  })
  assert.equal(d.outcome, 'incorrect')
  assert.ok(Math.abs(d.scored_brier - 0.49) < 1e-12)
})

test('a down-call is scored on its own direction', () => {
  const d = adjudicate(
    { ...signalCall, subject: { ...signalCall.subject, direction: 'down' } },
    {
      entry: { ts: signalCall.published_at, price: 100, source: 'candles_1m' },
      exit: { ts: signalCall.resolves_at, price: 95, source: 'candles_1m' },
      nowMs: t('2026-08-21T00:05:00Z'),
    },
  )
  assert.equal(d.outcome, 'correct')
})

test('a missing print inside the grace period WAITS — it is never scored', () => {
  const d = adjudicate(signalCall, {
    entry: { ts: signalCall.published_at, price: 100, source: 'candles_1m' },
    exit: null,
    nowMs: t('2026-08-21T00:05:00Z'),  // horizon just passed; grace not over
  })
  assert.equal(d.action, 'wait')
})

test('a data gap after grace resolves as unresolvable with NO Brier score', () => {
  const afterGrace = t(signalCall.resolves_at) + (GRACE_H + 1) * HOUR_MS
  const d = adjudicate(signalCall, { entry: null, exit: null, nowMs: afterGrace })
  assert.equal(d.action, 'resolve')
  assert.equal(d.outcome, 'unresolvable')
  assert.equal(d.scored_brier, null)
  assert.match(d.evidence.reason, /data gap is never scored/)
  assert.match(d.evidence.reason, /published_at and resolves_at/)
})

test('an unscorable subject resolves unresolvable immediately, with the reason', () => {
  const d = adjudicate(
    { ...signalCall, subject: { scope: 'cohort' } },
    { entry: null, exit: null, nowMs: t('2026-08-21T00:05:00Z') },
  )
  assert.equal(d.outcome, 'unresolvable')
  assert.equal(d.scored_brier, null)
  assert.match(d.evidence.reason, /subject is not scoreable/)
})

test('scoreableSubject names every missing field', () => {
  const { ok, errors } = scoreableSubject({ scope: 'cohort' })
  assert.equal(ok, false)
  assert.equal(errors.length, 2)
})

// Telegram message shape and the post-once bookkeeping live in
// test/telegram.test.mjs.
