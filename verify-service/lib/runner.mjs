/**
 * One verification job, start to finish: spec → replay → metrics → verdict →
 * immutable result row.
 *
 * The spec is re-validated here even though the API route validated it before
 * enqueueing. The queue is a database table; anything that can write to it can
 * put a spec in it, and a result is only worth what its spec was checked
 * against.
 */

import { validateSpec, specHash } from './spec.mjs'
import { Market } from './market.mjs'
import { replayCoin, assertInvariants, ENGINE_VERSION } from './engine.mjs'
import { loadCohortSeries, resolveCohortWallets, resolveTopCoins, TOP_COINS_LOOKAHEAD_FLAG } from './cohort.mjs'
import { summarize, evaluateVerdict, tradesCsv } from './metrics.mjs'
import { pageAll, uploadObject, RESULTS_BUCKET, sb } from './db.mjs'
import { publishResult } from './publish.mjs'

const HOUR_MS = 3_600_000

/** Coins in the spec's universe, plus any look-ahead flags that selection incurs. */
async function resolveUniverse(spec) {
  const coins = new Set(spec.universe.coins || [])
  const flags = []
  const n = spec.universe.cohort_filters?.top_n_coins_by_notional
  if (n) {
    for (const c of await resolveTopCoins(n)) coins.add(c)
    flags.push(TOP_COINS_LOOKAHEAD_FLAG)
  }
  return { coins: [...coins], flags }
}

/** capture_gaps pairs excluded from the cohort signal, per coin. */
async function excludedPairs(coins) {
  const out = []
  for (const coin of coins) {
    const rows = await pageAll(
      `capture_gaps?select=wallet_address,first_start_position&coin=eq.${encodeURIComponent(coin)}`
      + '&order=wallet_address.asc',
    )
    out.push({
      coin,
      excluded_wallets: rows.length,
      reason: 'capture_gaps: earliest retrievable fill had start_position != 0, so pre-capture history is '
        + 'incomplete and new-position classification cannot be trusted',
      sample_wallets: rows.slice(0, 20).map((r) => r.wallet_address),
    })
  }
  return out
}

export async function runJob(job, { log = console.log } = {}) {
  const spec = validateSpec(job.spec)
  const hash = specHash(spec)
  const now = Date.now()

  const { coins, flags } = await resolveUniverse(spec)
  if (coins.length === 0) throw new Error('universe resolved to zero coins — nothing to verify')

  const wallets = await resolveCohortWallets(spec.universe.cohort_filters)
  if (wallets && wallets.length === 0) {
    throw new Error('universe.cohort_filters matched zero wallets — the cohort signal would be empty, '
      + 'and an empty signal is not a result')
  }

  const usesCohort = JSON.stringify([spec.entry.rule, spec.exit.condition]).includes('"cohort"')
  const market = new Market({ now })
  const windowStart = Date.parse(spec.window.start)
  const windowEnd = Date.parse(spec.window.end)

  const replayLog = []
  const perCoin = []
  const allTrades = []

  for (const coin of coins) {
    let cohort = null
    if (usesCohort) {
      // Load the cohort lookback ahead of the window so the first in-window bar
      // can be evaluated against a complete trailing window.
      cohort = await loadCohortSeries(coin, windowStart - 31 * 24 * HOUR_MS, windowEnd, wallets)
    }
    log(`replaying ${coin} (${cohort ? `${cohort.rowCount} cohort hours from ${cohort.source}` : 'no cohort rules'})`)
    const { trades, coverage } = await replayCoin({ spec, coin, market, cohort, log: replayLog })
    perCoin.push(coverage)
    allTrades.push(...trades)
  }

  const servedFroms = perCoin.map((c) => c.served_from).filter(Boolean)
  const servedTos = perCoin.map((c) => c.served_to).filter(Boolean)
  const servedFrom = servedFroms.length ? servedFroms.sort()[0] : null
  const servedTo = servedTos.length ? servedTos.sort()[servedTos.length - 1] : null

  assertInvariants(allTrades, { frictions: spec.frictions, servedFrom: null, servedTo: null })
  for (const c of perCoin) {
    assertInvariants(
      allTrades.filter((t) => t.coin === c.coin),
      { frictions: spec.frictions, servedFrom: c.served_from, servedTo: c.served_to },
    )
  }

  allTrades.sort((a, b) => Date.parse(a.entry_ts) - Date.parse(b.entry_ts))

  const metrics = summarize(allTrades, { capitalBase: spec.sizing.notional_usd })
  const verdict = evaluateVerdict(spec.kill_criteria, metrics)

  const dataCoverage = {
    window_requested: { start: spec.window.start, end: spec.window.end },
    window_served: { start: servedFrom, end: servedTo },
    granularity_mix: market.granularityCounts,
    source_mix: market.sourceCounts,
    excluded_pairs: await excludedPairs(coins),
    coins,
    bar_interval: spec.bar_interval,
    cohort_wallets: wallets ? wallets.length : null,
    cohort_wallet_scope: wallets ? 'universe.cohort_filters' : 'all captured wallets (capture_gaps excluded)',
    per_coin: perCoin,
    look_ahead_flags: [...(spec.notes.look_ahead_flags || []), ...flags],
    skipped: replayLog,
    engine_now: new Date(now).toISOString(),
  }

  let csvPath = null
  const csv = tradesCsv(allTrades)
  try {
    csvPath = await uploadObject(RESULTS_BUCKET, `job-${job.id}/${hash}.csv`, csv)
  } catch (e) {
    // A storage outage must not silently drop the trade ledger: fail the job.
    throw new Error(`per-trade CSV upload failed, refusing to persist a result without it: ${e.message}`)
  }

  const [row] = await sb('verification_results', {
    method: 'POST',
    prefer: 'return=representation',
    body: [{
      job_id: job.id,
      spec,
      spec_hash: hash,
      trades_csv_path: csvPath,
      trade_count: allTrades.length,
      metrics,
      verdict,
      data_coverage: dataCoverage,
      engine_version: ENGINE_VERSION,
    }],
  })

  // Ledger publish, gated by the publishing rule (eligibility is re-checked
  // inside). A publish failure must not fail the job — the result row is
  // durable and the scorer's sweep re-publishes anything missed — but it is
  // loud, because a silent gap between results and calls is how a "public
  // ledger" quietly stops being one.
  try {
    await publishResult(row, { log })
  } catch (e) {
    log(`Ledger publish for result ${row.id} failed (sweep will retry): ${e.message}`)
  }

  return { result: row, metrics, verdict, dataCoverage, trades: allTrades, csv }
}
