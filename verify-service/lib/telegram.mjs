/**
 * Ledger → public Telegram channel (@alphalens_ledger).
 *
 * Deliberately SEPARATE from the watchdog alert bot: alerts are operational
 * (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID, private), the Ledger channel is
 * content (LEDGER_TELEGRAM_BOT_TOKEN + LEDGER_TELEGRAM_CHANNEL_ID, public).
 * The same bot may hold both tokens, but the chats may never be the same chat:
 * a stack trace does not belong in a research feed and a verdict does not
 * belong in an on-call channel. So this module refuses to fall back to the
 * alert env vars — unconfigured is a normal state, not a licence to borrow.
 *
 * Three properties this file owes the rest of the service:
 *
 *   1. It never blocks a publish or a resolution. Every entry point returns a
 *      status instead of throwing; a Telegram outage costs a channel post, and
 *      the post is retried later from the database. The Ledger is the source
 *      of truth, the channel is a mirror.
 *   2. It never posts twice. Every announcement claims its (call_id, phase)
 *      row in `ledger_telegram_posts` before sending, so a restart mid-backfill
 *      resumes rather than replays.
 *   3. It is polite. Sends are spaced (LEDGER_TELEGRAM_MIN_INTERVAL_MS,
 *      default 3.5s — Telegram's guidance for a channel is ~20 messages a
 *      minute) and a 429 is obeyed, not fought.
 *
 * No secrets in code, ever.
 */

import { sb } from './db.mjs'

const APP_URL = (
  process.env.LEDGER_PUBLIC_URL
  || process.env.NEXT_PUBLIC_APP_URL
  || 'https://alphalens-taupe.vercel.app'
).replace(/\/$/, '')

/** Space between sends. Telegram throttles a channel around 20 msg/min. */
const MIN_INTERVAL_MS = parseInt(process.env.LEDGER_TELEGRAM_MIN_INTERVAL_MS || '3500', 10)

/** Stop retrying a message that keeps failing; the row keeps the last error. */
export const MAX_ATTEMPTS = 5

/** Telegram's hard cap is 4096 characters; leave room for the frame. */
const MAX_MESSAGE = 3800
const MAX_CLAIM = 2600

export function ledgerTelegramConfigured() {
  return Boolean(process.env.LEDGER_TELEGRAM_BOT_TOKEN && process.env.LEDGER_TELEGRAM_CHANNEL_ID)
}

export const permalink = (id) => `${APP_URL}/ledger/${id}`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let lastSendAt = 0
async function pace() {
  const wait = lastSendAt + MIN_INTERVAL_MS - Date.now()
  if (wait > 0) await sleep(wait)
  lastSendAt = Date.now()
}

/**
 * POST one message. Returns the Telegram message id.
 *
 * A 429 carries `parameters.retry_after`: honour it once rather than hammering
 * a rate limiter that is already telling us the answer. Anything else throws
 * to the caller, which records the failure and moves on.
 */
async function sendMessage(text, { retryAfter429 = true } = {}) {
  const token = process.env.LEDGER_TELEGRAM_BOT_TOKEN
  const chat = process.env.LEDGER_TELEGRAM_CHANNEL_ID

  await pace()
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chat,
      text: text.slice(0, MAX_MESSAGE),
      disable_web_page_preview: false,
    }),
  })

  const body = await res.json().catch(() => ({}))
  if (res.ok && body?.ok) return { message_id: body.result?.message_id ?? null, chat: body.result?.chat }

  if (res.status === 429 && retryAfter429) {
    const wait = Number(body?.parameters?.retry_after || 5)
    await sleep((wait + 1) * 1000)
    return sendMessage(text, { retryAfter429: false })
  }
  // Name the chat we actually tried. "chat not found" says nothing about
  // whether the username is wrong, the channel does not exist, or the bot was
  // never added — and the first thing anyone needs is the value that failed.
  // The channel id is a public @name or a chat id, never a secret; the token
  // is neither logged nor interpolated into this message.
  throw new Error(
    `telegram sendMessage ${res.status} to ${chat}: ${String(body?.description || '').slice(0, 200)}`,
  )
}

// ── Message text (pure — this is what the tests pin down) ───────────────────

const KIND_LABEL = {
  hypothesis_verdict: 'hypothesis verdict',
  cohort_signal: 'cohort signal',
}

const OUTCOME_LABEL = {
  correct: 'CORRECT',
  incorrect: 'INCORRECT',
  unresolvable: 'UNRESOLVABLE (data gap)',
}

const kindLabel = (kind) => KIND_LABEL[kind] || String(kind || 'call').replace(/_/g, ' ')

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v))

/** Confidence is stored as a 0–1 probability; show it as a percentage. */
const confidencePct = (v) => {
  const n = num(v)
  return n === null || !Number.isFinite(n) ? null : `${Math.round(n * 100)}%`
}

const hours = (v) => {
  const n = num(v)
  if (n === null || !Number.isFinite(n)) return null
  return `${n >= 100 ? Math.round(n).toLocaleString('en-US') : n} h`
}

const instant = (ts) => (ts ? `${new Date(ts).toISOString().slice(0, 16).replace('T', ' ')} UTC` : null)

const clamp = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

/** One line naming what the call rests on, so two calls over the same
 * evidence are distinguishable in the feed rather than looking like a dupe. */
function evidenceLine(call) {
  const p = call.provenance || {}
  const bits = []
  if (p.engine) bits.push(String(p.engine))
  if (p.result_id !== undefined && p.result_id !== null) bits.push(`result #${p.result_id}`)
  if (p.research) bits.push(String(p.research))
  return bits.length ? `Evidence: ${bits.join(', ')}` : null
}

/**
 * Message for a freshly published call: what kind of call it is, the claim
 * itself, the verdict (a verdict call) or the horizon (a forward call), the
 * confidence where there is one, and the permalink. Plain text, no markup —
 * a claim can contain anything and escaping it is one more way to be wrong.
 */
export function formatCall(call) {
  const head = [`Ledger call #${call.id} — ${kindLabel(call.kind)}`]

  const verdict = call.subject?.verdict
  if (verdict) head.push(`Verdict: ${String(verdict).toUpperCase()}`)

  const conf = confidencePct(call.confidence)
  if (conf) head.push(`Confidence: ${conf}`)

  const horizon = hours(call.horizon_hours)
  if (horizon) {
    const resolves = instant(call.resolves_at)
    head.push(verdict
      ? `Evidence window: ${horizon} replayed`
      : `Horizon: ${horizon}${resolves ? ` — resolves ${resolves}` : ''}`)
  }

  const tail = [evidenceLine(call), permalink(call.id)].filter(Boolean)
  return [head.join('\n'), clamp(String(call.claim || ''), MAX_CLAIM), tail.join('\n')].join('\n\n')
}

/**
 * Message for a scored resolution: the outcome, the Brier score, the
 * permalink. An unresolvable call carries no score and says why — a gap at
 * the resolution instant is the absence of a measurement, and scoring it
 * either way would invent one.
 */
export function formatResolution(call) {
  const head = [`Ledger call #${call.id} resolved — ${OUTCOME_LABEL[call.outcome] || String(call.outcome)}`]

  const brier = num(call.scored_brier)
  if (brier === null) {
    head.push('No Brier score: a data gap is never scored either way.')
  } else {
    head.push(`Brier score: ${brier.toFixed(3)} (0 = perfect, 1 = maximally wrong)`)
    const conf = confidencePct(call.confidence)
    if (conf) head.push(`Called at ${conf} confidence.`)
  }

  return [head.join('\n'), clamp(String(call.claim || ''), MAX_CLAIM), permalink(call.id)].join('\n\n')
}

export const formatFor = (phase, call) => (phase === 'resolution' ? formatResolution(call) : formatCall(call))

// ── Claiming: post-once bookkeeping, in the database ───────────────────────

const isDuplicate = (e) => /duplicate key|23505/.test(String(e?.message || e))

/**
 * Take ownership of one (call, phase) announcement, or report that somebody
 * else already has it. The claim is written BEFORE the send: a claim with no
 * post is a retry ten minutes later, whereas a post with no claim is a double
 * post, and only one of those two is recoverable.
 *
 * @returns {Promise<boolean>} true when this process owns the send
 */
export async function claimPost(callId, phase, { attempts = 0, db = sb } = {}) {
  try {
    const rows = await db('ledger_telegram_posts', {
      method: 'POST',
      prefer: 'resolution=ignore-duplicates,return=representation',
      body: [{ call_id: callId, phase, attempts: 1, claimed_at: new Date().toISOString() }],
    })
    if (rows?.length) return true
  } catch (e) {
    if (!isDuplicate(e)) throw e
  }

  // A row already exists. Steal it only if its claim is stale — the filters
  // are the lock: two processes cannot both match posted_at=null AND the old
  // claimed_at, because whichever PATCHes first moves claimed_at forward.
  const stale = new Date(Date.now() - 10 * 60_000).toISOString()
  const taken = await db(
    `ledger_telegram_posts?call_id=eq.${callId}&phase=eq.${phase}`
    + `&posted_at=is.null&attempts=lt.${MAX_ATTEMPTS}&claimed_at=lt.${stale}`,
    {
      method: 'PATCH',
      prefer: 'return=representation',
      body: { claimed_at: new Date().toISOString(), attempts: attempts + 1 },
    },
  )
  return Boolean(taken?.length)
}

async function markPosted(callId, phase, messageId, { db = sb } = {}) {
  await db(`ledger_telegram_posts?call_id=eq.${callId}&phase=eq.${phase}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: {
      posted_at: new Date().toISOString(),
      message_id: messageId,
      channel: process.env.LEDGER_TELEGRAM_CHANNEL_ID || null,
      last_error: null,
    },
  })
}

async function markFailed(callId, phase, message, { db = sb } = {}) {
  await db(`ledger_telegram_posts?call_id=eq.${callId}&phase=eq.${phase}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: { last_error: String(message).slice(0, 500) },
  })
}

/**
 * Announce one call, once.
 *
 * Never throws: the caller is in the middle of publishing a call or writing a
 * resolution, and neither may be undone by a messaging failure. Returns a
 * status so the caller can log it and carry on.
 *
 * @returns {Promise<'posted'|'skipped'|'unconfigured'|'failed'>}
 */
export async function announce(call, phase, { log = () => {}, db = sb, attempts = 0 } = {}) {
  const text = formatFor(phase, call)

  if (!ledgerTelegramConfigured()) {
    log(`ledger telegram unconfigured — not posting ${phase} for call ${call.id}: ${text.split('\n')[0]}`)
    return 'unconfigured'
  }

  let owned = false
  try {
    owned = await claimPost(call.id, phase, { attempts, db })
  } catch (e) {
    log(`telegram claim failed for call ${call.id} ${phase}: ${e.message}`)
    return 'failed'
  }
  if (!owned) return 'skipped'

  try {
    const { message_id } = await sendMessage(text)
    await markPosted(call.id, phase, message_id, { db })
    log(`telegram: posted ${phase} for call ${call.id} (message ${message_id})`)
    return 'posted'
  } catch (e) {
    log(`telegram ${phase} post failed for call ${call.id}: ${e.message}`)
    await markFailed(call.id, phase, e.message, { db }).catch((err) =>
      log(`telegram: could not record failure for call ${call.id}: ${err.message}`))
    return 'failed'
  }
}

export const announceCall = (call, opts) => announce(call, 'publish', opts)
export const announceResolution = (call, opts) => announce(call, 'resolution', opts)

/**
 * Clear the failure counters on everything still unposted, so the sweep will
 * try again from the top.
 *
 * The five-attempt cap exists so ONE malformed call cannot hold up the queue
 * forever. It is the wrong instrument for a configuration failure — a wrong
 * channel id, a bot that is not an admin, a channel that does not exist yet —
 * because that fails every message equally, and burns all five attempts on
 * each of them within the hour. The Ledger would then be permanently
 * un-mirrored with nothing in the pending view to say so, which is the
 * failure mode this whole module is built to avoid.
 *
 * So: fix the configuration, run this, and the backlog posts on the next
 * sweep. The claims stay in place, so anything that DID post stays posted —
 * this resets the right to retry, never the record of having posted.
 *
 * @returns {Promise<number>} how many announcements were re-armed
 */
export async function resetFailed({ log = () => {}, db = sb } = {}) {
  const rows = await db('ledger_telegram_posts?posted_at=is.null&attempts=gt.0', {
    method: 'PATCH',
    prefer: 'return=representation',
    body: { attempts: 0, last_error: null, claimed_at: new Date(0).toISOString() },
  })
  const n = rows?.length || 0
  log(n ? `re-armed ${n} failed announcement(s) — the next sweep will retry them`
        : 'nothing to re-arm: no unposted announcement has a failed attempt')
  return n
}

/**
 * The catch-all, and the backfill: every call whose publish or resolution has
 * not reached the channel, oldest event first, so a cold channel opens with
 * the autopsy and the verdicts in the order they were made rather than in
 * whatever order a sweep happened to see them.
 *
 * Bounded per tick (the pacing above means a batch of 10 takes ~35s) and
 * driven by a SQL view, not a client-side anti-join over `ledger_calls` —
 * PostgREST would truncate that at ~1000 rows and start losing calls silently.
 */
export async function announceSweep({ limit = 10, log = () => {}, db = sb } = {}) {
  const counts = { posted: 0, skipped: 0, failed: 0, unconfigured: 0 }
  if (!ledgerTelegramConfigured()) return counts

  const pending = await db(
    `ledger_telegram_pending?select=call_id,phase,event_at,attempts,call`
    + `&order=event_at.asc,call_id.asc,phase.asc&limit=${limit}`,
  ) || []
  if (!pending.length) return counts

  log(`telegram sweep: ${pending.length} announcement(s) pending`)
  for (const row of pending) {
    counts[await announce(row.call, row.phase, { log, db, attempts: row.attempts })] += 1
  }
  return counts
}
