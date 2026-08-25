#!/usr/bin/env node
/**
 * Backfill the Ledger's two founding entries (Prompt F), exactly once each:
 *
 *   1. The copy-trading autopsy — the published research verdict
 *      (/research/copy-trading-autopsy) with provenance linking the research
 *      page and the backtest_results/ artifacts it was verified against.
 *      Every number in the claim is read from those artifacts, not typed from
 *      memory: v2_trades.csv holds 28,318 trades spanning 2025-08-11 to
 *      2026-08-15 (8,868 hours), v2_monthly_pnl.csv sums to net -$9,704.42,
 *      and gross before fees is -$5,380 — the same figures the research page
 *      publishes.
 *   2. verification_results id=5 (job 4) — through publishResult(), i.e. the
 *      same tested publishing rule every future result goes through.
 *
 * verification_results id=1 stays ineligible on purpose: pre-grammar engine,
 * non-conforming spec, no excluded-pairs disclosure. The row stays in the
 *  results table; the eligibility filter is what keeps it off the Ledger.
 *
 * Idempotent: entry 1 is keyed on provenance->research, entry 2 on the
 * partial unique index over provenance->result_id.
 *
 * Run: node publish-founding.mjs
 */

import { assertConfigured, sb } from './lib/db.mjs'
import { publishResult } from './lib/publish.mjs'

const log = (...a) => console.log(new Date().toISOString(), ...a)

export const AUTOPSY_RESEARCH_PATH = '/research/copy-trading-autopsy'

export const AUTOPSY_CALL = {
  kind: 'hypothesis_verdict',
  // published_at is left to the database default: the call is published the
  // moment this row lands, and a timestamp is never synthesized to claim
  // otherwise. The research publication date lives in provenance.
  subject: {
    scope: 'strategy',
    strategy: 'copy_trading',
    verdict: 'killed',
    cohorts: [
      'top 10 wallets by 30d Sharpe (7,499 copied trades, net -$1,251.58)',
      'profile-filtered cohort, 13 months (28,318 copied trades, net -$9,704.42)',
    ],
  },
  claim:
    'KILLED: "Copying the trades of top-performing Hyperliquid wallets is profitable after realistic '
    + 'frictions." — 28,318 copied trades replayed over 2025-08-11 to 2026-08-15 with floor frictions '
    + '(60s delay, 5bps slippage, 0.045% taker per side): net -$9,704.42, and gross before any fee was '
    + 'already -$5,380 — there was no edge for the frictions to eat. A second cohort (top 10 by 30d '
    + 'Sharpe) lost -$1,251.58 across 7,499 trades in under three days.',
  confidence: null,
  provenance: {
    engine: 'backtest_copy.py (runs v1 + v2)',
    research: AUTOPSY_RESEARCH_PATH,
    research_published: '2026-08-25',
    artifacts: 'backtest_results/ (trades.csv, monthly_pnl.csv, v2_trades.csv, v2_monthly_pnl.csv, '
      + 'v2_summary_by_archetype.csv, v2_delay_sensitivity.csv)',
  },
  horizon_hours: 8868,   // v2_trades.csv span: 2025-08-11T04:00Z .. 2026-08-15T16:06Z
  resolves_at: null,
}

async function publishAutopsy() {
  const existing = await sb(
    'ledger_calls?select=id&kind=eq.hypothesis_verdict'
    + `&provenance->>research=eq.${encodeURIComponent(AUTOPSY_RESEARCH_PATH)}&limit=1`,
  )
  if (existing?.length) {
    log(`autopsy founding entry already published as call ${existing[0].id} — skipping`)
    return existing[0].id
  }
  const [call] = await sb('ledger_calls', {
    method: 'POST',
    prefer: 'return=representation',
    body: [AUTOPSY_CALL],
  })
  log(`published founding entry: copy-trading autopsy as call ${call.id}`)
  return call.id
}

async function publishResult5() {
  const [result] = await sb('verification_results?select=*&id=eq.5&limit=1')
  if (!result) throw new Error('verification_results id=5 not found — nothing to publish')
  const out = await publishResult(result, { log })
  if (!out.published && out.reasons?.[0] !== 'already published') {
    throw new Error(`result 5 was not publishable: ${out.reasons?.join('; ')}`)
  }
  return out
}

async function main() {
  assertConfigured()
  await publishAutopsy()
  await publishResult5()

  const calls = await sb('ledger_calls?select=id,kind,published_at,provenance&order=id.asc&limit=10')
  log(`ledger now holds ${calls.length} call(s):`)
  for (const c of calls) {
    log(`  #${c.id} ${c.kind} — provenance ${JSON.stringify(c.provenance).slice(0, 120)}`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
