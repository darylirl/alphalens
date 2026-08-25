import test from 'node:test'
import assert from 'node:assert/strict'
import { summarize, evaluateVerdict, tradesCsv } from '../lib/metrics.mjs'

const trade = (over = {}) => ({
  coin: 'BTC', side: 'long', qty: 0.01, notional_usd: 1000,
  entry_signal_ts: '2026-06-01T00:00:00.000Z', entry_ts: '2026-06-01T00:01:00.000Z',
  entry_px: 100, entry_raw_px: 99.95, entry_source: 'fills', entry_granularity: 'tape',
  exit_signal_ts: '2026-06-02T00:00:00.000Z', exit_ts: '2026-06-02T00:01:00.000Z',
  exit_px: 110, exit_raw_px: 110.05, exit_source: 'fills', exit_granularity: 'tape',
  gross_pnl_usd: 10, fees_usd: 1, net_pnl_usd: 9, hold_s: 86_400, exit_reason: 'max_holding_time',
  delay_s: 60, slippage_bps: 5, taker_fee_pct: 0.045,
  ...over,
})

test('metrics report the whole shape a result needs', () => {
  const m = summarize([
    trade(),
    trade({ exit_ts: '2026-07-02T00:01:00.000Z', gross_pnl_usd: -4, fees_usd: 1, net_pnl_usd: -5 }),
  ], { capitalBase: 1000 })

  assert.equal(m.trade_count, 2)
  assert.equal(m.net_pnl_usd, 4)
  assert.equal(m.gross_pnl_usd, 6)
  assert.equal(m.fees_usd, 2)
  assert.equal(m.win_rate, 0.5)
  assert.equal(m.profit_factor, 1.8)
  assert.equal(m.max_drawdown_usd, 5)
  assert.equal(m.max_drawdown_pct, 0.5)
  assert.equal(m.capital_base_usd, 1000)
  assert.deepEqual(m.monthly.map((x) => x.month), ['2026-06', '2026-07'])
  assert.equal(m.worst_month_pnl_usd, -5)
  assert.equal(m.positive_month_ratio, 0.5)
  assert.equal(m.avg_hold_s, 86_400)
})

test('an all-winners run reports profit factor as infinite rather than as a number', () => {
  const m = summarize([trade(), trade()], { capitalBase: 1000 })
  assert.equal(m.profit_factor, null)
  assert.equal(m.profit_factor_infinite, true)

  const v = evaluateVerdict([{ id: 'weak', metric: 'profit_factor', op: 'lt', value: 1.2 }], m)
  assert.equal(v.criteria[0].observed, 'inf')
  assert.equal(v.criteria[0].pass, true)
})

test('a kill criterion passes when it is not triggered and fails when it is', () => {
  const m = summarize([trade({ gross_pnl_usd: -10, fees_usd: 1, net_pnl_usd: -11 })], { capitalBase: 1000 })
  const v = evaluateVerdict([
    { id: 'unprofitable', metric: 'net_pnl_usd', op: 'lte', value: 0, description: 'must make money' },
    { id: 'drawdown', metric: 'max_drawdown_pct', op: 'gt', value: 90, description: 'blow-up guard' },
  ], m)

  assert.equal(v.overall, 'killed')
  assert.deepEqual(v.killed_by, ['unprofitable'])
  assert.equal(v.criteria[0].pass, false)
  assert.equal(v.criteria[0].triggered, true)
  assert.equal(v.criteria[0].observed, -11)
  assert.equal(v.criteria[1].pass, true)
  assert.equal(v.criteria.length, 2, 'every pre-registered criterion is evaluated, not just the failing one')
})

test('a criterion whose metric could not be computed does not pass', () => {
  const m = summarize([], { capitalBase: 1000 })
  const v = evaluateVerdict([{ id: 'edge', metric: 'profit_factor', op: 'lt', value: 1.2 }], m)
  assert.equal(v.criteria[0].evaluable, false)
  assert.equal(v.criteria[0].pass, false)
  assert.equal(v.inconclusive, true)
  assert.equal(v.overall, 'killed')
  assert.match(v.criteria[0].note, /recorded as not passed rather than assumed survived/)
})

test('the verdict is a pass only when every criterion passes', () => {
  const m = summarize([trade()], { capitalBase: 1000 })
  const v = evaluateVerdict([
    { id: 'unprofitable', metric: 'net_pnl_usd', op: 'lte', value: 0 },
    { id: 'trades', metric: 'trade_count', op: 'lt', value: 1 },
  ], m)
  assert.equal(v.overall, 'pass')
  assert.deepEqual(v.killed_by, [])
})

test('the CSV carries the frictions and the fill provenance of every trade', () => {
  const csv = tradesCsv([trade()])
  const [header, row] = csv.trim().split('\n')
  for (const col of ['entry_source', 'entry_granularity', 'exit_source', 'exit_granularity',
    'delay_s', 'slippage_bps', 'taker_fee_pct', 'gross_pnl_usd', 'fees_usd', 'net_pnl_usd']) {
    assert.ok(header.split(',').includes(col), `CSV is missing ${col}`)
  }
  assert.equal(row.split(',').length, header.split(',').length)
})
