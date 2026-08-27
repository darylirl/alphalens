#!/usr/bin/env node
/**
 * Ledger scorer loop (Prompt F).
 *
 * Two jobs, both bounded, both paced, neither in pg_cron:
 *
 *   1. Publish sweep — any Ledger-eligible verification result that is
 *      missing its hypothesis_verdict call gets one (at-least-once safety net
 *      behind the runner's publish-at-result-time; the partial unique index
 *      on provenance->result_id makes double-publish impossible).
 *   2. Score — due cohort_signal calls resolve against captured tape via
 *      lib/scorer.mjs, which refuses to score across data gaps.
 *   3. Announce — anything in the Ledger the Telegram channel has not
 *      mirrored yet gets posted, oldest event first. Both write paths above
 *      also announce inline, so this is the catch-all AND the backfill: on
 *      first configuration it walks the whole Ledger from the beginning.
 *      Claimed in the database (ledger_telegram_posts), so a restart resumes
 *      rather than replaying.
 *
 * Capacity budget: every read is a single bounded page per tick, the loop
 * paces itself (SCORER_POLL_MS, default 5 minutes), and it is a killable
 * process — the same posture as backfill.mjs, for the same reason (heavy or
 * runaway work must never live where it cannot be stopped).
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SCORER_POLL_MS,
 *      SCORER_GRACE_H, LEDGER_TELEGRAM_BOT_TOKEN + LEDGER_TELEGRAM_CHANNEL_ID
 *      (optional — unconfigured means announcements are logged and dropped).
 *
 * Run: node scorer.mjs [--once]
 */

import { hostname } from 'node:os'
import { assertConfigured, heartbeat } from './lib/db.mjs'
import { scoreTick } from './lib/scorer.mjs'
import { sweepUnpublished } from './lib/publish.mjs'
import { announceSweep, ledgerTelegramConfigured } from './lib/telegram.mjs'

const POLL_MS = parseInt(process.env.SCORER_POLL_MS || String(5 * 60_000), 10)
const HEARTBEAT_MS = 60_000
const ONCE = process.argv.includes('--once')
const WORKER_ID = `${hostname()}:${process.pid}`

const log = (...a) => console.log(new Date().toISOString(), ...a)
const state = { ticks: 0, resolved: 0, published: 0, posted: 0, lastError: null }

async function beat() {
  try {
    await heartbeat({
      // service='scorer', not the worker's 'verify': a dead scorer must be
      // visible in capture_health rather than masked by the worker's beats.
      service: 'scorer',
      note: `scorer=${WORKER_ID} ticks=${state.ticks} resolved=${state.resolved}`
        + ` published=${state.published} posted=${state.posted}`
        + `${state.lastError ? ` lastError=${state.lastError.slice(0, 120)}` : ''}`,
    })
  } catch (e) { log('heartbeat failed:', e.message) }
}

async function tick() {
  const swept = await sweepUnpublished({ log })
  state.published += swept.published

  const scored = await scoreTick({ log })
  state.resolved += scored.resolved

  // Announcing last, and in its own try: a Telegram outage is never allowed
  // to abort a tick that has already published or resolved. Whatever it could
  // not post stays pending and is retried next tick.
  let announced = { posted: 0, failed: 0 }
  try {
    announced = await announceSweep({ log })
    state.posted += announced.posted
  } catch (e) {
    log('telegram sweep failed (ledger is unaffected):', e.message)
  }

  state.ticks += 1
  if (swept.published || scored.resolved || scored.waiting || announced.posted || announced.failed) {
    log(`tick: published=${swept.published} resolved=${scored.resolved} waiting=${scored.waiting}`
      + ` posted=${announced.posted} post_failed=${announced.failed}`)
  }
}

async function main() {
  assertConfigured()
  log(`ledger scorer starting: id=${WORKER_ID} poll=${POLL_MS}ms grace=${process.env.SCORER_GRACE_H || 24}h`
    + ` telegram=${ledgerTelegramConfigured() ? 'configured' : 'stubbed (env absent)'}`)
  if (!ONCE) { setInterval(beat, HEARTBEAT_MS); beat() }

  for (;;) {
    try {
      await tick()
    } catch (e) {
      state.lastError = e.message
      log('tick failed:', e.message)
    }
    if (ONCE) return
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
}

process.on('unhandledRejection', (e) => log('unhandledRejection:', e?.message || e))
main()
