/**
 * The replay invariants, as tests. Each one corresponds to a promise the
 * result rows make; if one of these fails, results produced by this engine are
 * not trustworthy and the job should abort rather than publish.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { validateSpec } from '../lib/spec.mjs'
import { replayCoin, assertInvariants, ReconciliationError, evalRule } from '../lib/engine.mjs'
import { CohortSeries } from '../lib/cohort.mjs'
import { summarize } from '../lib/metrics.mjs'

const HOUR = 3_600_000
const T0 = Date.parse('2026-06-01T00:00:00Z')

/**
 * Deterministic market stub: hourly bars whose close follows `priceAt`, and a
 * fill ladder that serves the tape for recent timestamps and coarse candles
 * for old ones — so the granularity/source disclosure has something to say.
 */
function stubMarket({ bars, priceAt, tapeUntil = Infinity, missingFillsAfter = Infinity }) {
  return {
    granularityCounts: {},
    sourceCounts: { fills: 0, candles_1m: 0, candleSnapshot: 0 },
    async loadBars() { return bars },
    async fillPrice(coin, decisionMs, isBuy, searchMs, slippageBps) {
      if (decisionMs >= missingFillsAfter) return null
      const onTape = decisionMs <= tapeUntil
      const source = onTape ? 'fills' : 'candleSnapshot'
      const granularity = onTape ? 'tape' : '4h'
      const step = onTape ? 60_000 : 4 * HOUR
      const ts = Math.ceil(decisionMs / step) * step
      // Mirrors Market._snapshotPrice: always search at least 3 bars, so a
      // 15-minute entry window does not make 4h bars unfillable by definition.
      if (ts - decisionMs > Math.max(searchMs, 3 * step)) return null
      const raw = priceAt(ts)
      const slip = slippageBps / 10_000
      this.sourceCounts[source] += 1
      this.granularityCounts[granularity] = (this.granularityCounts[granularity] || 0) + 1
      return { ts, price: isBuy ? raw * (1 + slip) : raw * (1 - slip), raw_price: raw, source, granularity }
    },
  }
}

function hourlyBars(fromMs, count, priceAt) {
  const bars = []
  for (let i = 0; i < count; i++) {
    const t = fromMs + i * HOUR
    bars.push({ t, o: priceAt(t), h: priceAt(t), l: priceAt(t), c: priceAt(t + HOUR), v: 1, close_ts: t + HOUR })
  }
  return bars
}

/** Cohort hours whose net flow flips sign every `flipEvery` hours. */
function cohortRows(startMs, hours, flipEvery = 48) {
  const rows = []
  for (let i = 0; i < hours; i++) {
    const positive = Math.floor(i / flipEvery) % 2 === 1
    rows.push({
      bucket: new Date(startMs + i * HOUR).toISOString(),
      fills: 10,
      wallets: 5,
      notional: 1_000_000,
      net_flow: positive ? 500_000 : -500_000,
      new_longs: positive ? 30 : 5,
      new_shorts: positive ? 5 : 30,
    })
  }
  return rows
}

const specFor = (overrides = {}) => validateSpec({
  spec_version: 1,
  hypothesis_text: 'Cohort net flow flipping positive precedes higher BTC.',
  universe: { coins: ['BTC'] },
  bar_interval: '1h',
  entry: { side: 'long', rule: { type: 'cohort', metric: 'net_flow_usd', window_h: 24, op: 'cross_above', value: 0 } },
  exit: { condition: null, max_holding_time_h: 24 },
  sizing: { mode: 'fixed_usd', notional_usd: 1000 },
  frictions: { delay_s: 60, slippage_bps: 5, taker_fee_pct: 0.045 },
  window: { start: new Date(T0).toISOString(), end: new Date(T0 + 30 * 24 * HOUR).toISOString() },
  kill_criteria: [{ id: 'unprofitable', metric: 'net_pnl_usd', op: 'lte', value: 0 }],
  notes: { look_ahead_flags: [], mechanism: 'pattern_based' },
  ...overrides,
})

const rising = (t) => 100 + ((t - T0) / HOUR) * 0.1

async function run({ spec = specFor(), cohortStart = T0 - 31 * 24 * HOUR, market, log = [] } = {}) {
  const barsFrom = T0 - 2 * 24 * HOUR
  const bars = hourlyBars(barsFrom, 32 * 24, rising)
  const cohort = new CohortSeries(
    cohortRows(cohortStart, Math.round((T0 + 30 * 24 * HOUR - cohortStart) / HOUR)),
    { coin: 'BTC', wallets: null },
  )
  const m = market || stubMarket({ bars, priceAt: rising })
  const out = await replayCoin({ spec, coin: 'BTC', market: m, cohort, log })
  return { ...out, market: m, log, cohort }
}

// ── invariant 1: never fabricate entries for uncovered history ──────────────

test('no entry is signalled before the cohort lookback is fully covered', async () => {
  // Cohort data starts 5 days INTO the requested window: everything before
  // cohortStart + 24h is uncovered, and must produce no signals.
  const cohortStart = T0 + 5 * 24 * HOUR
  const { trades, coverage } = await run({ cohortStart })

  const firstCovered = cohortStart + 24 * HOUR
  assert.equal(coverage.served_from, new Date(firstCovered).toISOString())
  assert.ok(trades.length > 0, 'expected trades after coverage begins')
  for (const t of trades) {
    assert.ok(Date.parse(t.entry_signal_ts) >= firstCovered,
      `entry at ${t.entry_signal_ts} predates covered data at ${new Date(firstCovered).toISOString()}`)
  }
  assert.doesNotThrow(() => assertInvariants(trades, {
    frictions: { delay_s: 60, slippage_bps: 5, taker_fee_pct: 0.045 },
    servedFrom: coverage.served_from,
    servedTo: coverage.served_to,
  }))
})

test('a cohort series with no captured data produces no trades at all', async () => {
  const log = []
  const cohort = new CohortSeries([], { coin: 'BTC', wallets: null })
  const bars = hourlyBars(T0 - 2 * 24 * HOUR, 32 * 24, rising)
  const { trades, coverage } = await replayCoin({
    spec: specFor(), coin: 'BTC', market: stubMarket({ bars, priceAt: rising }), cohort, log,
  })
  assert.equal(trades.length, 0)
  assert.equal(coverage.skipped, 'no_covered_bars')
  assert.match(log.join(' '), /not covered by captured data/)
})

test('assertInvariants rejects an entry signalled outside the served window', () => {
  const trade = {
    coin: 'BTC', entry_signal_ts: '2026-06-01T00:00:00.000Z', entry_ts: '2026-06-01T00:01:00.000Z',
    exit_ts: '2026-06-02T00:01:00.000Z', gross_pnl_usd: 10, fees_usd: 1, net_pnl_usd: 9,
    entry_granularity: 'tape', exit_granularity: 'tape', entry_source: 'fills', exit_source: 'fills',
    delay_s: 60, slippage_bps: 5, taker_fee_pct: 0.045,
  }
  assert.throws(
    () => assertInvariants([trade], {
      frictions: { delay_s: 60, slippage_bps: 5, taker_fee_pct: 0.045 },
      servedFrom: '2026-06-10T00:00:00.000Z', servedTo: '2026-07-01T00:00:00.000Z',
    }),
    /would be fabricated from history the capture does not cover/,
  )
})

test('an unpriceable entry is skipped and logged, never invented', async () => {
  const log = []
  const bars = hourlyBars(T0 - 2 * 24 * HOUR, 32 * 24, rising)
  const market = stubMarket({ bars, priceAt: rising, missingFillsAfter: T0 })
  const { trades } = await run({ market, log })
  assert.equal(trades.length, 0)
  assert.match(log.join(' '), /entry skipped \(not fabricated\)/)
})

// ── invariant 2: per-trade granularity + source disclosure ──────────────────

test('every trade discloses the granularity and source that priced it', async () => {
  const bars = hourlyBars(T0 - 2 * 24 * HOUR, 32 * 24, rising)
  // Tape coverage ends mid-window, so both ladder rungs are exercised.
  const market = stubMarket({ bars, priceAt: rising, tapeUntil: T0 + 15 * 24 * HOUR })
  const { trades } = await run({ market })

  assert.ok(trades.length > 0)
  for (const t of trades) {
    assert.ok(['tape', '4h'].includes(t.entry_granularity))
    assert.ok(['fills', 'candleSnapshot'].includes(t.entry_source))
    assert.ok(t.exit_granularity && t.exit_source)
  }
  assert.ok(market.sourceCounts.fills > 0 && market.sourceCounts.candleSnapshot > 0,
    'expected the ladder to fall back from tape to candles as history ages')
  assert.ok(Object.keys(market.granularityCounts).length >= 2)
})

// ── invariant 3: penny-exact reconciliation ─────────────────────────────────

test('net == gross - fees on every trade and in aggregate', async () => {
  const { trades } = await run()
  assert.ok(trades.length > 0)
  for (const t of trades) {
    assert.ok(Math.abs(t.net_pnl_usd - (t.gross_pnl_usd - t.fees_usd)) < 0.005,
      `${t.coin}: ${t.net_pnl_usd} != ${t.gross_pnl_usd} - ${t.fees_usd}`)
  }
  const m = summarize(trades, { capitalBase: 1000 })
  assert.ok(Math.abs(m.net_pnl_usd - (m.gross_pnl_usd - m.fees_usd)) < 0.005)
  assert.ok(Math.abs(m.reconciliation_residual_usd) < 0.005)
})

test('a trade whose net does not reconcile is rejected', () => {
  const trade = {
    coin: 'BTC', entry_signal_ts: '2026-06-01T00:00:00.000Z', entry_ts: '2026-06-01T00:01:00.000Z',
    exit_ts: '2026-06-02T00:01:00.000Z', gross_pnl_usd: 10, fees_usd: 1, net_pnl_usd: 9.5,
    entry_granularity: 'tape', exit_granularity: 'tape', entry_source: 'fills', exit_source: 'fills',
    delay_s: 60, slippage_bps: 5, taker_fee_pct: 0.045,
  }
  assert.throws(
    () => assertInvariants([trade], { frictions: { delay_s: 60, slippage_bps: 5, taker_fee_pct: 0.045 } }),
    ReconciliationError,
  )
})

test('summarize refuses to report totals that do not add up', () => {
  const t = (net) => ({
    coin: 'BTC', exit_ts: '2026-06-02T00:00:00.000Z', gross_pnl_usd: 10, fees_usd: 1,
    net_pnl_usd: net, hold_s: 3600, exit_reason: 'exit_condition',
  })
  assert.throws(() => summarize([t(9), t(12)], { capitalBase: 1000 }),
    /aggregate reconciliation failed/)
})

// ── invariant 4: explicit frictions on every fill ───────────────────────────

test('the 60s delay, 5bps slippage and 0.045% per-side fee are applied to both sides', async () => {
  const { trades } = await run()
  const t = trades[0]

  assert.ok(Date.parse(t.entry_ts) >= Date.parse(t.entry_signal_ts) + 60_000, 'entry filled before the delay')
  assert.ok(Date.parse(t.exit_ts) >= Date.parse(t.exit_signal_ts) + 60_000, 'exit filled before the delay')

  // buys pay up, sells receive less
  assert.ok(Math.abs(t.entry_px - t.entry_raw_px * 1.0005) < 1e-9)
  assert.ok(Math.abs(t.exit_px - t.exit_raw_px * 0.9995) < 1e-9)

  const expectedFees = t.qty * t.entry_px * 0.00045 + t.qty * t.exit_px * 0.00045
  assert.ok(Math.abs(t.fees_usd - expectedFees) < 1e-9, `fees ${t.fees_usd} != ${expectedFees}`)

  assert.equal(t.delay_s, 60)
  assert.equal(t.slippage_bps, 5)
  assert.equal(t.taker_fee_pct, 0.045)
})

test('higher-than-floor frictions flow through to the fills', async () => {
  const spec = specFor({ frictions: { delay_s: 900, slippage_bps: 25, taker_fee_pct: 0.1 } })
  const { trades } = await run({ spec })
  const t = trades[0]
  assert.ok(Date.parse(t.entry_ts) >= Date.parse(t.entry_signal_ts) + 900_000)
  assert.ok(Math.abs(t.entry_px - t.entry_raw_px * 1.0025) < 1e-9)
  assert.equal(t.taker_fee_pct, 0.1)
})

test('assertInvariants rejects a trade whose frictions differ from the spec', () => {
  const trade = {
    coin: 'BTC', entry_signal_ts: '2026-06-01T00:00:00.000Z', entry_ts: '2026-06-01T00:01:00.000Z',
    exit_ts: '2026-06-02T00:01:00.000Z', gross_pnl_usd: 10, fees_usd: 1, net_pnl_usd: 9,
    entry_granularity: 'tape', exit_granularity: 'tape', entry_source: 'fills', exit_source: 'fills',
    delay_s: 30, slippage_bps: 5, taker_fee_pct: 0.045,
  }
  assert.throws(
    () => assertInvariants([trade], { frictions: { delay_s: 60, slippage_bps: 5, taker_fee_pct: 0.045 } }),
    /frictions do not match the spec frictions/,
  )
})

// ── exits ───────────────────────────────────────────────────────────────────

test('the mandatory max holding time closes positions the rules would not', async () => {
  const { trades } = await run()
  assert.ok(trades.length > 0)
  assert.ok(trades.every((t) => t.hold_s <= 24 * 3600 + 4 * 3600 + 120),
    'a position outlived max_holding_time_h plus its fill search')
  assert.ok(trades.some((t) => t.exit_reason === 'max_holding_time'))
})

test('a position still open at the window end is force-closed and flagged', async () => {
  // Entry rule that fires on every bar: guarantees an open position at the end.
  const spec = specFor({
    entry: { side: 'long', rule: { type: 'time', rule: 'day_of_week', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] } },
    exit: { condition: null, max_holding_time_h: 8760 },
  })
  const { trades } = await run({ spec })
  assert.equal(trades.length, 1)
  assert.equal(trades[0].exit_reason, 'end_of_window')
})

// ── rule evaluation ─────────────────────────────────────────────────────────

test('an unevaluable input yields null, not false — and fires nothing', () => {
  const ctx = { closes: [10, 11], closeTs: [T0, T0 + HOUR], indicators: new Map(), cohort: null }
  assert.equal(evalRule({ type: 'cohort', metric: 'net_flow_usd', window_h: 24, op: 'gt', value: 0 }, ctx, 1), null)
  // Kleene: a definite false still short-circuits an `all`
  const rule = {
    all: [
      { type: 'time', rule: 'day_of_week', days: [] },
      { type: 'cohort', metric: 'net_flow_usd', window_h: 24, op: 'gt', value: 0 },
    ],
  }
  assert.equal(evalRule(rule, ctx, 1), false)
})

test('session rules that wrap midnight UTC are handled', () => {
  const ctx = { closes: [1], closeTs: [Date.parse('2026-06-01T23:30:00Z')], indicators: new Map(), cohort: null }
  assert.equal(evalRule({ type: 'time', rule: 'session', start_utc: '22:00', end_utc: '02:00' }, ctx, 0), true)
  assert.equal(evalRule({ type: 'time', rule: 'session', start_utc: '02:00', end_utc: '22:00' }, ctx, 0), false)
})
