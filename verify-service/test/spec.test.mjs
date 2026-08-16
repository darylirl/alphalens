import test from 'node:test'
import assert from 'node:assert/strict'
import { validateSpec, specHash, SpecError, FRICTION_FLOORS } from '../lib/spec.mjs'

const base = () => ({
  spec_version: 1,
  hypothesis_text: 'Cohort net flow flipping positive precedes higher BTC.',
  universe: { coins: ['BTC'] },
  entry: { side: 'long', rule: { type: 'cohort', metric: 'net_flow_usd', op: 'cross_above', value: 0 } },
  exit: { condition: null, max_holding_time_h: 24 },
  sizing: { mode: 'fixed_usd', notional_usd: 1000 },
  frictions: { delay_s: 60, slippage_bps: 5, taker_fee_pct: 0.045 },
  window: { start: '2026-06-01T00:00:00Z', end: '2026-08-01T00:00:00Z' },
  kill_criteria: [{ id: 'unprofitable', metric: 'net_pnl_usd', op: 'lte', value: 0 }],
  notes: { look_ahead_flags: [], mechanism: 'pattern_based' },
})

const rejects = (mutate, match) => {
  const spec = base()
  mutate(spec)
  assert.throws(() => validateSpec(spec), (e) => {
    assert.ok(e instanceof SpecError, `expected SpecError, got ${e}`)
    assert.match(e.message, match, `error message did not name the problem: ${e.message}`)
    return true
  })
}

test('a well-formed spec validates and normalizes', () => {
  const spec = validateSpec(base())
  assert.equal(spec.spec_version, 1)
  assert.equal(spec.bar_interval, '1h')                    // default
  assert.equal(spec.entry.rule.window_h, 24)               // cohort default
  assert.equal(spec.universe.coins[0], 'BTC')
})

// ── friction floors ─────────────────────────────────────────────────────────

test('frictions below the floor are rejected, not clamped', () => {
  for (const [key, floor] of Object.entries(FRICTION_FLOORS)) {
    rejects((s) => { s.frictions[key] = floor - 0.001 }, new RegExp(`frictions\\.${key}.*below the ${floor} floor`))
  }
})

test('frictions above the floor are accepted unchanged', () => {
  const spec = base()
  spec.frictions = { delay_s: 300, slippage_bps: 20, taker_fee_pct: 0.1 }
  const out = validateSpec(spec)
  assert.deepEqual(out.frictions, { delay_s: 300, slippage_bps: 20, taker_fee_pct: 0.1 })
})

test('frictions at exactly the floor are accepted', () => {
  const out = validateSpec(base())
  assert.deepEqual(out.frictions, { delay_s: 60, slippage_bps: 5, taker_fee_pct: 0.045 })
})

// ── grammar ─────────────────────────────────────────────────────────────────

test('an unsupported indicator is rejected and named', () => {
  rejects(
    (s) => { s.entry.rule = { type: 'indicator', indicator: 'macd', period: 12, op: 'gt', value: 0 } },
    /unsupported indicator "macd" — grammar v1 supports: ema, rsi, price_change_pct/,
  )
})

test('an unsupported rule type is rejected and named', () => {
  rejects(
    (s) => { s.entry.rule = { type: 'orderbook_imbalance', op: 'gt', value: 1 } },
    /unsupported rule type "orderbook_imbalance" — grammar v1 supports: indicator, cohort, time/,
  )
})

test('an unsupported cohort metric is rejected and named', () => {
  rejects(
    (s) => { s.entry.rule = { type: 'cohort', metric: 'whale_score', op: 'gt', value: 1 } },
    /unsupported cohort metric "whale_score" — grammar v1 supports: net_flow_usd, net_flow_skew, new_position_count/,
  )
})

test('an unsupported op is rejected and named', () => {
  rejects(
    (s) => { s.entry.rule = { type: 'indicator', indicator: 'rsi', period: 14, op: 'approaches', value: 30 } },
    /unsupported op "approaches" for rsi/,
  )
})

test('an unsupported time rule is rejected and named', () => {
  rejects(
    (s) => { s.entry.rule = { type: 'time', rule: 'lunar_phase' } },
    /unsupported time rule "lunar_phase" — grammar v1 supports: session, day_of_week/,
  )
})

test('nested unsupported rules report their path', () => {
  rejects(
    (s) => {
      s.entry.rule = {
        all: [
          { type: 'time', rule: 'day_of_week', days: ['mon'] },
          { any: [{ type: 'indicator', indicator: 'vwap', period: 20, op: 'gt', value: 1 }] },
        ],
      }
    },
    /entry\.rule\.all\[1\]\.any\[0\]: unsupported indicator "vwap"/,
  )
})

test('supported grammar constructs all validate', () => {
  const spec = base()
  spec.entry.rule = {
    all: [
      { type: 'indicator', indicator: 'ema', period: 20, op: 'cross_above' },
      { type: 'indicator', indicator: 'rsi', period: 14, op: 'lt', value: 70 },
      { type: 'indicator', indicator: 'price_change_pct', lookback_bars: 24, op: 'gt', value: 2 },
      { type: 'cohort', metric: 'new_position_count', side: 'long', window_h: 24, op: 'gte', value: 50 },
      { type: 'cohort', metric: 'net_flow_skew', window_h: 12, op: 'cross_above', value: 0.1 },
      { any: [{ type: 'time', rule: 'session', start_utc: '13:30', end_utc: '20:00' }] },
      { not: { type: 'time', rule: 'day_of_week', days: ['sat', 'sun'] } },
    ],
  }
  const out = validateSpec(spec)
  assert.equal(out.entry.rule.all.length, 7)
})

// ── mandatory fields ────────────────────────────────────────────────────────

test('a missing max holding time is rejected', () => {
  rejects((s) => { delete s.exit.max_holding_time_h }, /max_holding_time_h: mandatory/)
})

test('empty kill criteria are rejected', () => {
  rejects((s) => { s.kill_criteria = [] }, /kill_criteria: required non-empty array/)
})

test('an unsupported kill metric is rejected and named', () => {
  rejects((s) => { s.kill_criteria = [{ id: 'x', metric: 'sortino', op: 'lt', value: 1 }] },
    /unsupported metric "sortino"/)
})

test('notes must declare look-ahead flags and a mechanism stance', () => {
  rejects((s) => { delete s.notes }, /notes: required object/)
  rejects((s) => { s.notes = { look_ahead_flags: [], mechanism: 'stated' } }, /mechanism_text: required/)
})

test('an empty universe is rejected', () => {
  rejects((s) => { s.universe = { coins: [] } }, /universe: give explicit coins, cohort_filters, or both/)
})

test('an unsupported sizing mode is rejected and named', () => {
  rejects((s) => { s.sizing = { mode: 'kelly', notional_usd: 1000 } }, /unsupported sizing mode "kelly"/)
})

test('a future spec_version is rejected', () => {
  rejects((s) => { s.spec_version = 2 }, /unsupported spec_version 2/)
})

test('validation reports every problem at once, not just the first', () => {
  const spec = base()
  spec.frictions.delay_s = 1
  spec.kill_criteria = []
  delete spec.exit.max_holding_time_h
  try {
    validateSpec(spec)
    assert.fail('expected rejection')
  } catch (e) {
    assert.ok(e.errors.length >= 3, `expected >= 3 errors, got ${e.errors.length}`)
  }
})

// ── hashing ─────────────────────────────────────────────────────────────────

test('spec_hash is stable under key order and changes with content', () => {
  const a = validateSpec(base())
  const b = validateSpec({ ...base() })
  assert.equal(specHash(a), specHash(b))
  assert.match(specHash(a), /^[0-9a-f]{64}$/)

  const changed = base()
  changed.frictions.slippage_bps = 6
  assert.notEqual(specHash(validateSpec(changed)), specHash(a))
})
