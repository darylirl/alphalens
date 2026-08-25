import test from 'node:test'
import assert from 'node:assert/strict'
import { CohortSeries } from '../lib/cohort.mjs'
import { ema, rsi, priceChangePct } from '../lib/indicators.mjs'

const HOUR = 3_600_000
const T0 = Date.parse('2026-06-01T00:00:00Z')

const rows = (n, fn) => Array.from({ length: n }, (_, i) => ({
  bucket: new Date(T0 + i * HOUR).toISOString(),
  fills: 1,
  wallets: 1,
  notional: 1000,
  net_flow: fn(i),
  new_longs: i,
  new_shorts: 0,
}))

test('a rolling read never includes the hour it is evaluated in', () => {
  // Hour 47 carries a huge value. A read AT the start of hour 47 must not see
  // it: that bucket has not closed, and reading it would be look-ahead.
  const s = new CohortSeries(rows(72, (i) => (i === 47 ? 1_000_000 : 1)), { coin: 'BTC', wallets: null })
  const at47 = s.at(T0 + 47 * HOUR, 24)
  assert.equal(at47.net_flow_usd, 24, 'read at hour 47 must cover hours 23..46 only')

  const at48 = s.at(T0 + 48 * HOUR, 24)
  assert.equal(at48.net_flow_usd, 1_000_000 + 23, 'read at hour 48 covers hours 24..47')

  // Mid-hour reads are just as strict: at 47:30 the 47 bucket is still open.
  const mid = s.at(T0 + 47 * HOUR + 30 * 60_000, 24)
  assert.equal(mid.net_flow_usd, 24)
})

test('a rolling read that is not fully covered by data returns null', () => {
  const s = new CohortSeries(rows(72, () => 1), { coin: 'BTC', wallets: null })
  assert.equal(s.at(T0 + 12 * HOUR, 24), null, 'only 12 hours of history exist')
  assert.equal(s.at(T0 + 24 * HOUR, 24).net_flow_usd, 24)
  assert.equal(s.at(T0 + 500 * HOUR, 24), null, 'past the end of the data')
})

test('firstEvaluableMs is the start of data plus the lookback', () => {
  const s = new CohortSeries(rows(72, () => 1), { coin: 'BTC', wallets: null })
  assert.equal(s.firstEvaluableMs(24), T0 + 24 * HOUR)
  assert.equal(s.firstEvaluableMs(48), T0 + 48 * HOUR)
  assert.equal(new CohortSeries([], { coin: 'BTC' }).firstEvaluableMs(24), null)
  assert.equal(new CohortSeries([], { coin: 'BTC' }).at(T0, 24), null)
})

test('cohort metrics match the pulse_24h shapes', () => {
  const s = new CohortSeries(
    Array.from({ length: 48 }, (_, i) => ({
      bucket: new Date(T0 + i * HOUR).toISOString(),
      fills: 2, wallets: 2, notional: 1000, net_flow: 250, new_longs: 3, new_shorts: 1,
    })),
    { coin: 'BTC', wallets: null },
  )
  const at = T0 + 24 * HOUR
  assert.equal(s.metric('net_flow_usd', at, 24), 6000)
  assert.equal(s.metric('net_flow_skew', at, 24), 0.25)          // 6000 / 24000
  assert.equal(s.metric('new_position_count', at, 24, 'long'), 72)
  assert.equal(s.metric('new_position_count', at, 24, 'short'), 24)
  assert.equal(s.metric('new_position_count', at, 24, 'net'), 48)
})

test('an hour the aggregate never built is a hole, not zero flow', () => {
  // Rows exist only at hour 0 and hour 47. Under the old zero-filling series
  // every hour between them read as "cohort net flow was exactly 0" — an
  // outage rendered as tradeable data. Now they read as uncovered.
  const sparse = [
    { bucket: new Date(T0).toISOString(), fills: 1, wallets: 1, notional: 100, net_flow: 100, new_longs: 1, new_shorts: 0 },
    { bucket: new Date(T0 + 47 * HOUR).toISOString(), fills: 1, wallets: 1, notional: 100, net_flow: -50, new_longs: 0, new_shorts: 1 },
  ]
  const s = new CohortSeries(sparse, { coin: 'BTC', wallets: null })
  assert.equal(s.at(T0 + 48 * HOUR, 24), null, 'a window spanning un-built hours must not evaluate')
  assert.equal(s.at(T0 + 30 * HOUR, 24), null, 'un-built hours must never read as zero flow')
  assert.equal(s.metric('net_flow_usd', T0 + 30 * HOUR, 24), null)
})

test('a covered hour with no row for this coin is a real zero', () => {
  // Coverage says the aggregate was built for all 48 hours; this coin simply
  // did not trade in most of them. That is a genuine zero, not a hole.
  const covered = new Set(Array.from({ length: 48 }, (_, i) => Math.floor((T0 + i * HOUR) / HOUR)))
  const rows = [
    { bucket: new Date(T0 + 40 * HOUR).toISOString(), fills: 2, wallets: 1, notional: 500, net_flow: 250, new_longs: 1, new_shorts: 0 },
  ]
  const s = new CohortSeries(rows, { coin: 'QUIET', wallets: null, coveredHours: covered })
  const agg = s.at(T0 + 47 * HOUR, 24)
  assert.ok(agg, 'a fully covered window must evaluate even when this coin was idle')
  assert.equal(agg.net_flow_usd, 250)
  assert.equal(s.coverageSource, 'aggregate build coverage')
})

test('holes are reported and the longest covered run is exposed', () => {
  const covered = new Set([
    ...Array.from({ length: 10 }, (_, i) => Math.floor(T0 / HOUR) + i),        // 0..9
    ...Array.from({ length: 30 }, (_, i) => Math.floor(T0 / HOUR) + 20 + i),   // 20..49
  ])
  const s = new CohortSeries([], { coin: 'BTC', wallets: null, coveredHours: covered })
  assert.equal(s.holes.length, 1)
  assert.equal(s.holes[0].hours, 10)
  const run = s.longestCoveredRun()
  assert.equal(run[0], (Math.floor(T0 / HOUR) + 20) * HOUR)
  assert.equal(run[1], (Math.floor(T0 / HOUR) + 50) * HOUR)
})

test('firstEvaluableMs skips a run that is shorter than the lookback', () => {
  const base = Math.floor(T0 / HOUR)
  const covered = new Set([
    ...Array.from({ length: 5 }, (_, i) => base + i),          // too short for 24h
    ...Array.from({ length: 40 }, (_, i) => base + 30 + i),    // long enough
  ])
  const s = new CohortSeries([], { coin: 'BTC', wallets: null, coveredHours: covered })
  assert.equal(s.firstEvaluableMs(24), (base + 30 + 23 + 1) * HOUR)
})

// ── indicators ──────────────────────────────────────────────────────────────

test('EMA is null until it is seeded, then tracks price', () => {
  const closes = Array.from({ length: 50 }, (_, i) => 100 + i)
  const e = ema(closes, 10)
  assert.equal(e[8], null)
  assert.equal(e[9], 104.5)                     // SMA seed of 100..109
  assert.ok(e[49] > e[40] && e[49] < closes[49])
})

test('RSI is 100 on an unbroken advance and low on a decline', () => {
  const up = Array.from({ length: 40 }, (_, i) => 100 + i)
  assert.equal(rsi(up, 14)[39], 100)
  const down = Array.from({ length: 40 }, (_, i) => 200 - i)
  assert.ok(rsi(down, 14)[39] < 1)
  // 14 periods need 14 differences, so the first defined value sits at index 14.
  assert.equal(rsi(up, 14)[14], 100)
  assert.equal(rsi(up, 14)[13], null)
})

test('price_change_pct is null before the lookback is available', () => {
  const closes = [100, 101, 102, 103]
  const p = priceChangePct(closes, 2)
  assert.equal(p[1], null)
  assert.ok(Math.abs(p[2] - 2) < 1e-9)
})
