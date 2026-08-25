#!/usr/bin/env node
/**
 * Worker-paced cohort aggregate backfill.
 *
 * This deliberately does NOT run in pg_cron. Aggregating `fills` is heavy and
 * gets heavier as capture accrues; four cron slices at two-minute pacing once
 * saturated this instance's IO badly enough that PostgREST stopped answering
 * and the capture daemon lost writes for the better part of an hour. A worker
 * can be paced, observed, and stopped — a cron schedule can only be edited
 * from inside the database it is busy overloading.
 *
 * Safety properties:
 *   - ONE slice at a time. No parallel slices, ever.
 *   - A lease (cohort_flow_backfill_claim) is the overlap guard: a second
 *     runner cannot advance the same slice while this one holds it, and the
 *     lease expires so a crashed runner does not block progress forever.
 *   - Each step is a single idempotent DELETE+INSERT over a bounded hour
 *     range, so a step that fails simply repeats.
 *   - Pacing between steps is the throttle. Default is 10 minutes, matching
 *     the cadence agreed for this database.
 *
 * Usage:
 *   node backfill.mjs --slice history --from 2026-06-16T00:00:00Z \
 *                     --to 2026-08-16T00:00:00Z [--step-hours 6] [--pace-ms 600000]
 *   node backfill.mjs --slice history ... --once     # a single step, then exit
 */

import { hostname } from 'node:os'
import { assertConfigured, rpc, sb } from './lib/db.mjs'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
}
const flag = (name) => argv.includes(`--${name}`)

const SLICE = arg('slice', 'history')
const FROM = arg('from')
const TO = arg('to')
const STEP_HOURS = parseInt(arg('step-hours', '6'), 10)
const PACE_MS = parseInt(arg('pace-ms', String(10 * 60_000)), 10)
const ONCE = flag('once')
const RUNNER = `${hostname()}:${process.pid}`

if (!FROM || !TO) {
  console.error('usage: node backfill.mjs --slice <name> --from <iso> --to <iso> [--step-hours N] [--pace-ms N] [--once]')
  process.exit(1)
}

const log = (...a) => console.log(new Date().toISOString(), ...a)

async function step() {
  const claimed = await rpc('cohort_flow_backfill_claim', {
    p_slice: SLICE, p_from: FROM, p_to: TO, p_by: RUNNER,
    p_ttl: `${Math.max(Math.round(PACE_MS / 1000) * 2, 600)} seconds`,
  })
  if (claimed !== true) {
    log(`slice "${SLICE}" is leased by another runner; skipping this tick`)
    return 'leased'
  }

  try {
    const result = await rpc('cohort_flow_backfill_slice', {
      p_slice: SLICE, p_from: FROM, p_to: TO, p_step: `${STEP_HOURS} hours`,
    })
    const message = typeof result === 'string' ? result : JSON.stringify(result)
    log(message)
    return message.includes('complete') ? 'complete' : 'progressed'
  } finally {
    await rpc('cohort_flow_backfill_release', { p_slice: SLICE }).catch((e) =>
      log('lease release failed (it will expire):', e.message))
  }
}

async function main() {
  assertConfigured()
  log(`backfill starting: slice=${SLICE} ${FROM} .. ${TO} step=${STEP_HOURS}h pace=${PACE_MS}ms runner=${RUNNER}`)

  for (;;) {
    let outcome
    try {
      outcome = await step()
    } catch (e) {
      log('step failed, will retry after the pace interval:', e.message)
      outcome = 'error'
    }

    if (outcome === 'complete') {
      const [state] = await sb(
        `cohort_flow_backfill_state?select=slice,filled_from,target_from&slice=eq.${encodeURIComponent(SLICE)}`,
      )
      log(`slice "${SLICE}" complete: built back to ${state?.filled_from}`)
      return
    }
    if (ONCE) return
    await new Promise((r) => setTimeout(r, PACE_MS))
  }
}

process.on('unhandledRejection', (e) => log('unhandledRejection:', e?.message || e))
main()
