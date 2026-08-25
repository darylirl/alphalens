import test from 'node:test'
import assert from 'node:assert/strict'
import { ledgerEligibility, ledgerEligibleOnly } from '../lib/publish.mjs'

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

test('filtering keeps eligible rows and drops the rest without mutating them', () => {
  const rows = [
    { id: 1, engine_version: 'e2e-runner-0.1.0', spec: conformingSpec },
    { id: 2, engine_version: 'verify-engine@1.0.0', spec: conformingSpec },
  ]
  assert.deepEqual(ledgerEligibleOnly(rows).map((r) => r.id), [2])
  assert.equal(rows.length, 2, 'filtering must not delete history')
})
