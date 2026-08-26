/**
 * Cohort replay pre-builder (Replay v2.1) — a low-priority loop inside the
 * verification worker (NOT pg_cron; heavy work never goes there, see
 * CLAUDE.md) that keeps the default replay document warm for every cohort
 * wallet, most-active first. The /cohort links and the example chips land on
 * /replay/<address>, whose first request is the default doc — this loop makes
 * that request ahead of the first viewer.
 *
 * The loop is deliberately dumb: it calls the app's own doc endpoint with
 * prebuild=1 and lets the ROUTE decide freshness (served cached, or rebuilt
 * when new fills passed the refresh threshold — REFRESH_FILL_THRESHOLD in
 * lib/replay/docspec.ts). One builder implementation, so the pre-built doc
 * and a viewer-built doc cannot disagree.
 *
 * Low priority is enforced two ways: the loop yields whenever a verification
 * job is running, and it paces itself between wallets. One wallet at a time,
 * bounded reads, killable at any point — the queue of work is rediscovered
 * from the database on every sweep.
 *
 * Env: REPLAY_APP_URL (e.g. https://alphalens.vercel.app; unset = disabled),
 *      PREBUILD_SWEEP_MS (pause between full sweeps, default 10 min),
 *      PREBUILD_GAP_MS (pause between wallets, default 3 s).
 */

import { sb } from './lib/db.mjs'

const APP_URL = (process.env.REPLAY_APP_URL || '').replace(/\/$/, '')
const SWEEP_MS = parseInt(process.env.PREBUILD_SWEEP_MS || String(10 * 60_000), 10)
const GAP_MS = parseInt(process.env.PREBUILD_GAP_MS || '3000', 10)
/** A cold build pages a wallet's full captured history; give it room. */
const BUILD_TIMEOUT_MS = 120_000
const PAGE = 500

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Cohort wallets, most-active first, paged (PostgREST truncates ~1000). */
async function listCohortWallets() {
  const wallets = []
  for (let offset = 0; ; offset += PAGE) {
    const page = await sb(
      'wallets?select=address,trade_count_30d'
      + '&capture_enabled=eq.true&removed_at=is.null'
      + '&order=trade_count_30d.desc.nullslast,address.asc'
      + `&limit=${PAGE}&offset=${offset}`
    )
    wallets.push(...page)
    if (page.length < PAGE) break
  }
  return wallets
}

/** One wallet's default doc: ask the app; the route serves cached or builds.
 *  The response is NDJSON (a build) or JSON (already cached). */
async function warmWallet(address) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), BUILD_TIMEOUT_MS)
  try {
    const res = await fetch(
      `${APP_URL}/api/replay/${address}/doc?range=default&prebuild=1`,
      { signal: controller.signal }
    )
    const text = await res.text()
    if (!res.ok) return { ok: false, note: `HTTP ${res.status}: ${text.slice(0, 200)}` }
    const lines = text.split('\n').filter(Boolean)
    let last = null
    try {
      last = JSON.parse(lines[lines.length - 1])
    } catch {
      return { ok: false, note: 'unparseable response' }
    }
    if (last.cached) return { ok: true, cached: true, behind: last.behind ?? 0 }
    if (last.phase === 'done') {
      return { ok: true, cached: false, buildMs: last.build_ms, cacheWrite: last.cache_write }
    }
    return { ok: false, note: last.error || 'build did not finish' }
  } catch (e) {
    return { ok: false, note: e.name === 'AbortError' ? 'timed out' : e.message }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Run forever, alongside the job loop. `isBusy()` reports whether a
 * verification job is running — pre-building always yields to real work.
 */
export function startPrebuildLoop({ isBusy, log }) {
  if (!APP_URL) {
    log('replay prebuild disabled (REPLAY_APP_URL unset)')
    return
  }
  log(`replay prebuild loop starting: app=${APP_URL} sweep=${SWEEP_MS}ms gap=${GAP_MS}ms`)

  const run = async () => {
    for (;;) {
      let built = 0
      let cached = 0
      let failed = 0
      try {
        const wallets = await listCohortWallets()
        log(`prebuild sweep: ${wallets.length} cohort wallets, most-active first`)
        for (const w of wallets) {
          while (isBusy()) await sleep(5000) // verification jobs come first
          const r = await warmWallet(w.address)
          if (!r.ok) {
            failed++
            log(`prebuild ${w.address}: FAILED — ${r.note}`)
          } else if (r.cached) {
            cached++
          } else {
            built++
            log(`prebuild ${w.address}: built in ${((r.buildMs ?? 0) / 1000).toFixed(1)}s`)
            if (r.cacheWrite === 'failed') {
              // Built but not stored: the app cannot write replay_docs
              // (missing service-role key?). Every sweep would rebuild every
              // wallet — stop this sweep and say so, loudly, once.
              log('prebuild ABORTING sweep: the app reports cache_write=failed — '
                + 'built docs are not being stored (check SUPABASE_SERVICE_ROLE_KEY on the app)')
              break
            }
          }
          await sleep(GAP_MS)
        }
        log(`prebuild sweep done: ${built} built, ${cached} already warm, ${failed} failed`)
      } catch (e) {
        // A failed sweep must not kill the worker; the next one starts clean.
        log('prebuild sweep failed:', e.message)
      }
      await sleep(SWEEP_MS)
    }
  }
  run().catch((e) => log('prebuild loop crashed:', e.message))
}
