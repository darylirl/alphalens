#!/usr/bin/env node
/**
 * Ledger → Telegram announcer, as a one-shot CLI.
 *
 * The same sweep the scorer runs every tick (lib/telegram.mjs), exposed as a
 * command so the channel can be opened by hand: on first configuration this
 * backfills every existing call, oldest first, so the channel opens with the
 * autopsy and the verdicts rather than an empty room.
 *
 * Idempotent by construction — every announcement claims its (call_id, phase)
 * row in `ledger_telegram_posts` before sending, so running this twice, or
 * running it while the scorer is up, posts nothing a second time.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *      LEDGER_TELEGRAM_BOT_TOKEN, LEDGER_TELEGRAM_CHANNEL_ID,
 *      LEDGER_TELEGRAM_MIN_INTERVAL_MS (optional, default 3500),
 *      LEDGER_PUBLIC_URL (optional, permalink base).
 *
 * Run: node announce.mjs [--limit N] [--dry-run] [--reset-failed]
 *
 * `--reset-failed` clears the attempt counters on everything still unposted.
 * Use it after fixing a configuration fault (wrong channel id, bot not an
 * admin, channel not created yet): those fail every message equally and would
 * otherwise burn the five-attempt cap on each one, leaving the Ledger
 * permanently un-mirrored with an empty pending view.
 */

import { assertConfigured, sb } from './lib/db.mjs'
import { announceSweep, formatFor, ledgerTelegramConfigured, resetFailed } from './lib/telegram.mjs'

const log = (...a) => console.log(new Date().toISOString(), ...a)

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? fallback : process.argv[i + 1]
}
const LIMIT = parseInt(arg('--limit', '100'), 10)
const DRY = process.argv.includes('--dry-run')
const RESET = process.argv.includes('--reset-failed')

async function dryRun() {
  const pending = await sb(
    'ledger_telegram_pending?select=call_id,phase,event_at,attempts,call'
    + `&order=event_at.asc,call_id.asc,phase.asc&limit=${LIMIT}`,
  ) || []
  log(`${pending.length} announcement(s) pending (dry run — nothing sent):`)
  for (const row of pending) {
    console.log(`\n──── call ${row.call_id} / ${row.phase} (event ${row.event_at}) ────`)
    console.log(formatFor(row.phase, row.call))
  }
}

async function main() {
  assertConfigured()
  if (DRY) return dryRun()
  if (RESET) await resetFailed({ log })

  if (!ledgerTelegramConfigured()) {
    log('LEDGER_TELEGRAM_BOT_TOKEN / LEDGER_TELEGRAM_CHANNEL_ID are not set — nothing to post.')
    log('This is a normal state, not an error: set both to open the channel.')
    process.exitCode = 1
    return
  }

  const counts = await announceSweep({ limit: LIMIT, log })
  log(`done: posted=${counts.posted} skipped=${counts.skipped} failed=${counts.failed}`)
  if (counts.failed) process.exitCode = 1
}

main().catch((e) => { console.error(e); process.exit(1) })
