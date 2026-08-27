#!/usr/bin/env node
/**
 * Publish ONE forward-looking cohort_signal call to the Ledger.
 *
 * The coin, direction and confidence are arguments, not something this script
 * infers: which skew is worth calling is a judgement, and a judgement should
 * be made by a person and then checked by code, not manufactured by code and
 * then believed by a person. What the script does enforce is that the
 * judgement survives contact with the live data:
 *
 *   1. It reads the CURRENT /api/pulse snapshot from production — the same
 *      numbers a reader of the site sees — and records the matview refresh
 *      time, wallet count, notional and net flow in provenance.
 *   2. It refuses a direction the snapshot does not support, and a skew under
 *      the wallet/notional/skew floors in lib/publish.mjs.
 *   3. It preflights the price tape with the SCORER'S OWN reader: if the coin
 *      has no captured print in the last search window, the call would resolve
 *      'unresolvable' by construction, so it is not published at all.
 *   4. It publishes through lib/publish.mjs — never a direct insert — so the
 *      subject shape, the scoreability check and the snapshot dedup all apply.
 *
 * Usage:
 *   node publish-cohort-signal.mjs --coin HYPE --direction down \
 *     --confidence 0.55 [--horizon-hours 24] [--analysis-file notes.json] \
 *     [--pulse-url https://…/api/pulse] [--dry-run]
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (+ optional LEDGER_TELEGRAM_*).
 */

import { readFileSync } from 'node:fs'
import { assertConfigured } from './lib/db.mjs'
import { publishCohortSignal, cohortSignalCall } from './lib/publish.mjs'
import { priceAt, PRICE_SEARCH_MIN } from './lib/scorer.mjs'

const log = (...a) => console.log(new Date().toISOString(), ...a)

const DEFAULT_PULSE_URL =
  (process.env.LEDGER_PUBLIC_URL || 'https://alphalens-taupe.vercel.app').replace(/\/$/, '') + '/api/pulse'

function parseArgs(argv) {
  const out = { horizonHours: 24, pulseUrl: DEFAULT_PULSE_URL, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') { out.dryRun = true; continue }
    const v = argv[++i]
    if (a === '--coin') out.coin = v
    else if (a === '--direction') out.direction = v
    else if (a === '--confidence') out.confidence = Number(v)
    else if (a === '--horizon-hours') out.horizonHours = Number(v)
    else if (a === '--pulse-url') out.pulseUrl = v
    else if (a === '--analysis-file') out.analysis = JSON.parse(readFileSync(v, 'utf8'))
    else throw new Error(`unknown argument: ${a}`)
  }
  if (!out.coin) throw new Error('--coin is required')
  if (!out.direction) throw new Error('--direction is required (up|down)')
  if (!Number.isFinite(out.confidence)) throw new Error('--confidence is required')
  return out
}

/**
 * The pulse snapshot for one coin, straight from production. The coverage
 * block travels with it: a call derived from a snapshot whose capture was not
 * live is a call derived from an unknown window, and that has to be on the
 * record rather than in someone's memory.
 */
export async function fetchPulseCoin(coin, pulseUrl) {
  const res = await fetch(pulseUrl, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`GET ${pulseUrl}: ${res.status}`)
  const body = await res.json()
  const row = (body.coins || []).find((c) => c.coin === coin)
  if (!row) {
    throw new Error(
      `${coin} is not in the current pulse snapshot (${(body.coins || []).length} coins) — `
      + 'a coin with no captured 24h flow has no positioning to call',
    )
  }
  return { ...row, computedAt: body.coverage?.computedAt ?? null, coverage: body.coverage ?? null }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  assertConfigured()

  const snapshot = await fetchPulseCoin(args.coin, args.pulseUrl)
  log(`pulse snapshot ${snapshot.computedAt}: ${snapshot.coin}`
    + ` net_flow=$${snapshot.netFlowUsd.toLocaleString('en-US')}`
    + ` notional=$${snapshot.notionalUsd.toLocaleString('en-US')}`
    + ` wallets=${snapshot.activeWallets} long_pct=${snapshot.longPct}`)
  if (!snapshot.coverage?.live) {
    throw new Error('capture is not live in the pulse coverage block — refusing to call off a stale snapshot')
  }

  // Preflight with the scorer's own tape reader, one search window back: if
  // there is no captured print for this coin now, there will be none at the
  // resolution instant either, and an unresolvable call teaches nothing.
  const probeMs = Date.now() - PRICE_SEARCH_MIN * 60_000
  const probe = await priceAt(args.coin, probeMs)
  if (!probe) {
    throw new Error(
      `no captured price print for ${args.coin} within ${PRICE_SEARCH_MIN}m of `
      + `${new Date(probeMs).toISOString()} — this call could only resolve 'unresolvable'`,
    )
  }
  log(`tape preflight ok: ${args.coin} ${probe.source} print ${probe.price} at ${probe.ts}`)

  const input = {
    coin: args.coin,
    direction: args.direction,
    confidence: args.confidence,
    publishedAt: new Date().toISOString(),
    horizonHours: args.horizonHours,
    snapshot,
    analysis: args.analysis ?? null,
  }

  if (args.dryRun) {
    log('--dry-run: the call that WOULD be published:')
    console.log(JSON.stringify(cohortSignalCall(input), null, 2))
    return
  }

  const out = await publishCohortSignal(input, { log })
  if (!out.published) {
    log(`not published: ${out.reasons?.join('; ')}`)
    process.exitCode = 1
    return
  }
  const base = (process.env.LEDGER_PUBLIC_URL || 'https://alphalens-taupe.vercel.app').replace(/\/$/, '')
  log(`permalink: ${base}/ledger/${out.call.id}`)
  log(`resolves_at: ${out.call.resolves_at}`)
  console.log(JSON.stringify(out.call, null, 2))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e.message); process.exit(1) })
}
