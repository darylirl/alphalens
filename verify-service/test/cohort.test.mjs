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

test('hours with no captured fills read as zero flow, not as missing', () => {
  const sparse = [
    { bucket: new Date(T0).toISOString(), fills: 1, wallets: 1, notional: 100, net_flow: 100, new_longs: 1, new_shorts: 0 },
    { bucket: new Date(T0 + 47 * HOUR).toISOString(), fills: 1, wallets: 1, notional: 100, net_flow: -50, new_longs: 0, new_shorts: 1 },
  ]
  const s = new CohortSeries(sparse, { coin: 'BTC', wallets: null })
  assert.equal(s.at(T0 + 48 * HOUR, 24).net_flow_usd, -50)
  assert.equal(s.at(T0 + 30 * HOUR, 24).net_flow_usd, 0)
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
