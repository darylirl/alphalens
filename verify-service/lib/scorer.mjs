/**
 * Ledger scorer — resolves cohort_signal calls at their horizon against
 * captured tape, and nothing else.
 *
 * Honesty rules, in force here exactly as in the replay engine:
 *
 *   1. MISSING DATA IS NEVER ZERO, and never a price. A call resolves against
 *      the first captured print at/after its published_at and resolves_at
 *      instants (1m candles first, cohort fills as fallback), each within a
 *      bounded search window. If either print is missing, the call is NOT
 *      scored: the scorer waits out a grace period (late capture backfill may
 *      still land), and only then records outcome='unresolvable' with the gap
 *      documented in resolution_evidence — no Brier score, because a number
 *      scored across a gap would be an invented measurement.
 *   2. AGGREGATE AND STRATEGY-LEVEL ONLY. The subject grammar scored here has
 *      no wallet field, and the database CHECK (ledger_subject_ok) rejects
 *      one anyway. No per-wallet verdicts anywhere.
 *   3. ONE RESOLUTION, EVER. The write goes through a guarded UPDATE filtered
 *      on resolved_at=is.null; the append-only trigger rejects anything but a
 *      one-time fill of the resolution block. A lost race is a skip, not an
 *      overwrite.
 */

import { sb, rpc } from './db.mjs'
import { announceResolution } from './telegram.mjs'

const HOUR_MS = 3_600_000

/** Bounded search around each target instant for a captured print. */
export const PRICE_SEARCH_MIN = 15

/** How long past resolves_at we keep waiting for tape before declaring a
 * permanent gap. Late-arriving capture backfill can still fill a hole. */
export const GRACE_H = Number(process.env.SCORER_GRACE_H || 24)

/**
 * The machine-readable claim a cohort_signal subject must carry to be
 * scoreable: which coin, and which direction its price is called to move
 * between published_at and resolves_at.
 */
export function scoreableSubject(subject) {
  const errors = []
  if (typeof subject?.coin !== 'string' || !subject.coin) errors.push('subject.coin: required coin symbol')
  if (subject?.direction !== 'up' && subject?.direction !== 'down') {
    errors.push('subject.direction: required "up" or "down"')
  }
  return { ok: errors.length === 0, errors }
}

/**
 * First captured print at/after `targetMs`, within PRICE_SEARCH_MIN minutes.
 * Candles are the primary tape (regular grid); the cohort fills tape is the
 * fallback. Returns {ts, price, source} or null — never a synthesized price.
 */
export async function priceAt(coin, targetMs) {
  const from = new Date(targetMs).toISOString()
  const to = new Date(targetMs + PRICE_SEARCH_MIN * 60_000).toISOString()

  const candles = await rpc('verify_tape_prices', {
    p_coin: coin, p_from: from, p_to: to, p_limit: 1, p_offset: 0,
  })
  if (candles?.length) {
    return { ts: candles[0].t, price: Number(candles[0].o), source: 'candles_1m' }
  }

  const fills = await rpc('verify_tape_prices_at', {
    p_coin: coin, p_targets: [from], p_search: `${PRICE_SEARCH_MIN} minutes`,
  })
  const hit = fills?.[0]
  if (hit?.ts !== null && hit?.ts !== undefined && hit?.price !== null && hit?.price !== undefined) {
    return { ts: hit.ts, price: Number(hit.price), source: 'fills' }
  }
  return null
}

/**
 * Decide one call's resolution from its two prints. Pure — this is the part
 * unit tests pin down.
 *
 * @returns {{action: 'wait'} | {action: 'resolve', outcome, scored_brier, evidence}}
 */
export function adjudicate(call, { entry, exit, nowMs }) {
  const resolvesMs = Date.parse(call.resolves_at)
  const graceOverMs = resolvesMs + GRACE_H * HOUR_MS
  const base = {
    method: `first captured print at/after each instant, ${PRICE_SEARCH_MIN}m search`,
    entry_target: call.published_at,
    exit_target: call.resolves_at,
    entry,
    exit,
  }

  const subj = scoreableSubject(call.subject)
  if (!subj.ok) {
    // Permanently unscorable by construction, not by data: record it as such
    // immediately rather than pretending time will fix the subject.
    return {
      action: 'resolve',
      outcome: 'unresolvable',
      scored_brier: null,
      evidence: { ...base, reason: `subject is not scoreable: ${subj.errors.join('; ')}` },
    }
  }

  if (!entry || !exit) {
    if (nowMs < graceOverMs) return { action: 'wait' }
    return {
      action: 'resolve',
      outcome: 'unresolvable',
      scored_brier: null,
      evidence: {
        ...base,
        reason: `no captured print within ${PRICE_SEARCH_MIN}m of `
          + `${!entry ? 'published_at' : ''}${!entry && !exit ? ' and ' : ''}${!exit ? 'resolves_at' : ''}`
          + ` after a ${GRACE_H}h grace period — a data gap is never scored either way`,
      },
    }
  }

  const up = exit.price > entry.price
  const cameTrue = call.subject.direction === 'up' ? up : exit.price < entry.price
  const y = cameTrue ? 1 : 0
  const confidence = Number(call.confidence)
  return {
    action: 'resolve',
    outcome: cameTrue ? 'correct' : 'incorrect',
    scored_brier: (confidence - y) ** 2,
    evidence: {
      ...base,
      direction_called: call.subject.direction,
      move_pct: entry.price > 0 ? ((exit.price - entry.price) / entry.price) * 100 : null,
    },
  }
}

/**
 * Due, unresolved cohort_signal calls — one bounded page, oldest due first.
 * A backlog beyond the page resolves across successive ticks; the cap is the
 * capacity budget, not an assumption that the result set is small.
 */
export async function dueCalls({ limit = 25, nowMs = Date.now() } = {}) {
  return await sb(
    'ledger_calls?select=*&kind=eq.cohort_signal&resolved_at=is.null'
    + `&resolves_at=lte.${new Date(nowMs).toISOString()}`
    + `&order=resolves_at.asc&limit=${limit}`,
  ) || []
}

/** Resolve one due call. Returns 'resolved' | 'waiting' | 'lost_race'. */
export async function scoreCall(call, { nowMs = Date.now(), log = () => {} } = {}) {
  const coin = typeof call.subject?.coin === 'string' ? call.subject.coin : null
  const [entry, exit] = coin
    ? await Promise.all([priceAt(coin, Date.parse(call.published_at)), priceAt(coin, Date.parse(call.resolves_at))])
    : [null, null]

  const decision = adjudicate(call, { entry, exit, nowMs })
  if (decision.action === 'wait') {
    log(`call ${call.id}: tape gap at horizon, within grace — waiting for late capture`)
    return 'waiting'
  }

  // Guarded one-time write: the resolved_at=is.null filter (plus the DB
  // trigger) means two scorers cannot both resolve, and nobody can re-resolve.
  const updated = await sb(`ledger_calls?id=eq.${call.id}&resolved_at=is.null`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body: {
      resolved_at: new Date(nowMs).toISOString(),
      outcome: decision.outcome,
      scored_brier: decision.scored_brier,
      resolution_evidence: decision.evidence,
    },
  })
  if (!updated?.length) {
    log(`call ${call.id}: already resolved by another scorer — skipping`)
    return 'lost_race'
  }

  log(`call ${call.id} resolved: ${decision.outcome}`
    + (decision.scored_brier === null ? '' : ` (brier ${decision.scored_brier.toFixed(3)})`))
  // Same posture as the publish path: the resolution is already written and
  // immutable; the channel post is a mirror that may fail and be retried.
  await announceResolution(updated[0], { log }).catch((e) => log(`telegram announce failed: ${e.message}`))
  return 'resolved'
}

/** One scorer pass: resolve every due call in this tick's bounded page. */
export async function scoreTick({ nowMs = Date.now(), log = () => {} } = {}) {
  const due = await dueCalls({ nowMs })
  const counts = { resolved: 0, waiting: 0, lost_race: 0 }
  for (const call of due) {
    counts[await scoreCall(call, { nowMs, log })] += 1
  }
  return counts
}
