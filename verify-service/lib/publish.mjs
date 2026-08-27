/**
 * Ledger eligibility.
 *
 * A result being IN `verification_results` means it was measured honestly and
 * survived the database's shape and friction constraints. It does not mean it
 * may be published. Two engines have written to this table, and one of them
 * predates rule grammar v1 — a spec it produced cannot be re-run by the
 * canonical engine, so a number derived from it cannot be stood behind.
 *
 * This is a FILTER, never a deletion. `verification_results` is append-only by
 * design; removing an honest measurement to tidy the record would be its own
 * dishonesty. Ineligible rows stay, and stay out of anything user-facing.
 *
 * See CLAUDE.md, "Publishing rule: what may reach the Ledger".
 */

import { validateSpec, SpecError } from './spec.mjs'
import { sb } from './db.mjs'
import { announceCall } from './telegram.mjs'
// The scorer's own rules, imported rather than restated: a call is publishable
// only if the code that will have to resolve it can read it.
import { scoreableSubject, PRICE_SEARCH_MIN } from './scorer.mjs'

export const CANONICAL_ENGINE_PREFIX = 'verify-engine@'

/**
 * @param {{engine_version?: string, spec?: unknown}} result a verification_results row
 * @returns {{eligible: boolean, reasons: string[]}} reasons is empty when eligible
 */
export function ledgerEligibility(result) {
  const reasons = []

  const engine = result?.engine_version
  if (typeof engine !== 'string' || !engine.startsWith(CANONICAL_ENGINE_PREFIX)) {
    reasons.push(
      `engine_version ${JSON.stringify(engine ?? null)} is not the canonical engine `
      + `(expected a version starting "${CANONICAL_ENGINE_PREFIX}")`,
    )
  }

  try {
    validateSpec(result?.spec)
  } catch (e) {
    if (e instanceof SpecError) {
      reasons.push(`spec does not conform to the current grammar, so the engine could not re-run it: `
        + e.errors.slice(0, 3).join('; '))
    } else {
      throw e
    }
  }

  return { eligible: reasons.length === 0, reasons }
}

/** Convenience for read paths: keep only what may be published. */
export function ledgerEligibleOnly(results) {
  return results.filter((r) => ledgerEligibility(r).eligible)
}

// ── Publishing: eligible results become Ledger calls ────────────────────────

const HOUR_MS = 3_600_000

/**
 * Build the hypothesis_verdict call a Ledger-eligible verification result
 * publishes as. Pure — throws if the result is not eligible, so a call can
 * never be constructed from a row the publishing rule rejects.
 *
 * The call is strategy-level by construction: its subject names the spec and
 * the coins, never a wallet. horizon_hours is the replay window — the span of
 * evidence behind the verdict — and the call carries no resolution block
 * because the verdict IS its resolution (the immutable result row).
 */
export function hypothesisVerdictCall(result) {
  const { eligible, reasons } = ledgerEligibility(result)
  if (!eligible) {
    throw new Error(`result ${result?.id ?? '?'} is not Ledger-eligible: ${reasons.join('; ')}`)
  }

  const spec = validateSpec(result.spec)  // normalized form, same as the engine ran
  const windowMs = Date.parse(spec.window.end) - Date.parse(spec.window.start)
  const overall = result.verdict?.overall
  if (overall !== 'pass' && overall !== 'killed') {
    throw new Error(`result ${result.id} has no adjudicated verdict.overall — cannot publish a verdict call`)
  }

  const net = Number(result.metrics?.net_pnl_usd)
  const label = overall === 'killed' ? 'KILLED' : 'SURVIVED'
  const claim =
    `${label}: "${spec.hypothesis_text}" — replayed over ${spec.window.start.slice(0, 10)}`
    + ` to ${spec.window.end.slice(0, 10)} under floor-or-worse frictions`
    + ` (${spec.frictions.delay_s}s delay, ${spec.frictions.slippage_bps}bps slippage,`
    + ` ${spec.frictions.taker_fee_pct}% taker/side): ${result.trade_count} trades,`
    + ` net ${Number.isFinite(net) ? `$${net.toFixed(2)}` : 'n/a'}.`

  return {
    kind: 'hypothesis_verdict',
    subject: {
      scope: 'strategy',
      strategy: 'spec_replay',
      coins: spec.universe.coins,
      verdict: overall,
      spec_version: spec.spec_version,
    },
    claim,
    confidence: null,
    provenance: {
      engine: result.engine_version,
      spec_hash: result.spec_hash,
      result_id: result.id,
      job_id: result.job_id,
    },
    horizon_hours: windowMs / HOUR_MS,
    resolves_at: null,
  }
}

const isDuplicateCall = (e) =>
  /uq_ledger_calls_result|duplicate key|23505/.test(String(e?.message || e))

/**
 * Publish one verification result to the Ledger, if and only if the
 * publishing rule admits it. Idempotent two ways, because this is the shared
 * path for the runner's publish-at-result AND the scorer's sweep:
 *
 *  - by spec: a re-run of the same spec (identical spec_hash) reproduces the
 *    same verdict — reproduction is evidence, not news. If any
 *    hypothesis_verdict call already exists for this spec_hash, the result is
 *    skipped and the existing call id is logged. (Checked here rather than by
 *    a constraint: no schema change; the historical duplicate, calls 2 and 5,
 *    stays untouched as honest history.)
 *  - by result: the partial unique index on provenance->result_id makes a
 *    concurrent second publish of the same row a no-op.
 *
 * @returns {{published: boolean, call?: object, reasons?: string[]}}
 */
export async function publishResult(result, { log = () => {}, db = sb } = {}) {
  const { eligible, reasons } = ledgerEligibility(result)
  if (!eligible) {
    log(`result ${result.id} not Ledger-eligible: ${reasons.join('; ')}`)
    return { published: false, reasons }
  }

  const existing = await db(
    'ledger_calls?select=id&kind=eq.hypothesis_verdict'
    + `&provenance->>spec_hash=eq.${result.spec_hash}&order=id.asc&limit=1`,
  )
  if (existing?.length) {
    log(`result ${result.id} spec ${String(result.spec_hash).slice(0, 12)}… already published`
      + ` as Ledger call ${existing[0].id} — skipping (dedup by spec_hash)`)
    return { published: false, reasons: [`spec already published as call ${existing[0].id}`] }
  }

  const row = hypothesisVerdictCall(result)
  let call
  try {
    ;[call] = await db('ledger_calls', {
      method: 'POST',
      prefer: 'return=representation',
      body: [row],
    })
  } catch (e) {
    if (isDuplicateCall(e)) {
      log(`result ${result.id} already has a Ledger call — skipping`)
      return { published: false, reasons: ['already published'] }
    }
    throw e
  }

  log(`published Ledger call ${call.id} for result ${result.id} (${row.subject.verdict})`)
  await announceCall(call, { log }).catch((e) => log(`telegram announce failed: ${e.message}`))
  return { published: true, call }
}

/**
 * At-least-once safety net: publish any recent eligible result whose call is
 * missing (e.g. the runner crashed between the result insert and the ledger
 * insert). Bounded on purpose — one page of the most recent results, newest
 * first; anything older was already swept when it was recent.
 */
export async function sweepUnpublished({ limit = 50, log = () => {}, db = sb } = {}) {
  const results = await db(
    'verification_results?select=id,job_id,spec,spec_hash,trade_count,metrics,verdict,engine_version'
    + `&order=id.desc&limit=${limit}`,
  )
  if (!results?.length) return { published: 0 }

  const ids = results.map((r) => r.id).join(',')
  const existing = await db(
    `ledger_calls?select=provenance&kind=eq.hypothesis_verdict`
    + `&provenance->>result_id=in.(${ids})&order=id.asc&limit=${limit}`,
  )
  const done = new Set((existing || []).map((c) => Number(c.provenance?.result_id)))

  let published = 0
  for (const result of results) {
    if (done.has(result.id)) continue
    // publishResult also dedups by spec_hash, so a result whose spec was
    // already published under a different result id is skipped, not re-called.
    const { published: ok } = await publishResult(result, { log, db })
    if (ok) published += 1
  }
  return { published }
}

// ── Publishing: forward-looking cohort signals ──────────────────────────────

/**
 * A cohort_signal is the only Ledger kind published BEFORE its evidence
 * exists: it names a coin, a direction and an instant, and the scorer settles
 * it later against captured tape. That asymmetry is exactly why this path is
 * the strict one.
 *
 * Three things are checked here that no database constraint can check:
 *
 *  1. THE DEPLOYED SCORER MUST BE ABLE TO RESOLVE IT. The subject is run
 *     through the scorer's own `scoreableSubject()`, not a local copy of the
 *     rules. A call the scorer cannot read resolves 'unresolvable' by
 *     construction — a permanent hole in the calibration curve dressed up as
 *     a data gap — so it is refused at publication instead.
 *  2. THE STATED DIRECTION MUST BE THE SNAPSHOT'S DIRECTION. The pulse
 *     snapshot the call is derived from is passed in and re-read here: a call
 *     to go short against net-long positioning, or off a skew too small or
 *     too thinly-populated to be anything but noise, is refused. Publishing
 *     the opposite of your own evidence is not a contrarian call, it is an
 *     undocumented one.
 *  3. THE SNAPSHOT MUST BE RECORDED. provenance carries the matview refresh
 *     time, wallet count, notional and net flow the call was read from, so
 *     the call can be re-derived from the same numbers later. A signal whose
 *     basis is not written down cannot be audited, only believed.
 *
 * resolves_at is computed from publishedAt and the horizon rather than
 * accepted separately, so horizon_hours and the resolution instant can never
 * disagree — the scorer trusts resolves_at and the reader trusts the horizon.
 */

/** Floors below which a skew is not a signal. Guardrails, not preferences. */
export const SIGNAL_MIN_WALLETS = 3
export const SIGNAL_MIN_SKEW_PCT = 5
export const SIGNAL_MIN_NOTIONAL_USD = 250_000

const usd = (n) => `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`

/**
 * Build the cohort_signal row. Pure — throws rather than returning a call
 * that the scorer, the database, or the honesty contract would reject.
 *
 * @param {object} input
 * @param {string} input.coin            coin symbol, as the tape names it
 * @param {'up'|'down'} input.direction  the called direction of price
 * @param {number} input.confidence      P(claim true), strictly in (0, 1)
 * @param {string} input.publishedAt     ISO instant of publication (= entry)
 * @param {number} input.horizonHours    hours to resolution
 * @param {object} input.snapshot        the /api/pulse row + coverage it came from
 * @param {object} [input.analysis]      supporting figures recorded in provenance
 */
export function cohortSignalCall({
  coin, direction, confidence, publishedAt, horizonHours, snapshot, analysis = null,
}) {
  const errors = []

  // 1. Scoreable by the deployed scorer — its rules, not a copy of them.
  const subject = { scope: 'cohort', coin, direction }
  const scoreable = scoreableSubject(subject)
  if (!scoreable.ok) errors.push(...scoreable.errors)

  if (!(Number(confidence) > 0 && Number(confidence) < 1)) {
    errors.push('confidence: must be strictly between 0 and 1 (a probability, not a certainty)')
  }
  if (!(Number(horizonHours) > 0)) errors.push('horizonHours: must be positive')
  const publishedMs = Date.parse(publishedAt)
  if (!Number.isFinite(publishedMs)) errors.push('publishedAt: must be an ISO instant')

  // 2. The snapshot must exist, be legible, and point the way the call points.
  const netFlow = Number(snapshot?.netFlowUsd)
  const notional = Number(snapshot?.notionalUsd)
  const wallets = Number(snapshot?.activeWallets)
  const computedAt = snapshot?.computedAt
  if (snapshot?.coin !== coin) {
    errors.push(`snapshot.coin ${JSON.stringify(snapshot?.coin ?? null)} is not the coin being called (${coin})`)
  }
  if (!Number.isFinite(netFlow) || !Number.isFinite(notional) || notional <= 0) {
    errors.push('snapshot: netFlowUsd and a positive notionalUsd are required')
  }
  if (!Number.isFinite(wallets)) errors.push('snapshot.activeWallets: required')
  if (typeof computedAt !== 'string' || !Number.isFinite(Date.parse(computedAt))) {
    errors.push('snapshot.computedAt: the matview refresh time is required — an unrecorded snapshot is unauditable')
  }

  const skewPct = Number.isFinite(netFlow) && notional > 0 ? (netFlow / notional) * 100 : NaN
  if (Number.isFinite(skewPct)) {
    const snapshotDirection = skewPct > 0 ? 'up' : 'down'
    if (direction !== snapshotDirection) {
      errors.push(
        `direction "${direction}" contradicts the snapshot: net flow ${usd(netFlow)} is `
        + `${netFlow >= 0 ? 'net long' : 'net short'} (${skewPct.toFixed(1)}% of notional)`,
      )
    }
    if (Math.abs(skewPct) < SIGNAL_MIN_SKEW_PCT) {
      errors.push(
        `snapshot skew ${skewPct.toFixed(1)}% is under the ${SIGNAL_MIN_SKEW_PCT}% floor — `
        + 'a balanced book is not a directional call',
      )
    }
  }
  if (Number.isFinite(wallets) && wallets < SIGNAL_MIN_WALLETS) {
    errors.push(`snapshot has ${wallets} active wallet(s), under the ${SIGNAL_MIN_WALLETS} floor — `
      + 'one or two wallets are a position, not a cohort')
  }
  if (Number.isFinite(notional) && notional < SIGNAL_MIN_NOTIONAL_USD) {
    errors.push(`snapshot notional ${usd(notional)} is under the ${usd(SIGNAL_MIN_NOTIONAL_USD)} floor`)
  }

  if (errors.length) throw new Error(`cohort_signal is not publishable: ${errors.join('; ')}`)

  const resolvesAt = new Date(publishedMs + Number(horizonHours) * HOUR_MS).toISOString()
  const publishedIso = new Date(publishedMs).toISOString()
  const side = direction === 'up' ? 'higher' : 'lower'

  // The claim states the resolution procedure the scorer actually runs, so it
  // is falsifiable as written: no clause here needs a human to interpret it.
  const claim =
    `${coin} is strictly ${side} ${horizonHours}h from publication: the first captured price print at or after `
    + `${resolvesAt} is ${direction === 'up' ? 'above' : 'below'} the first captured print at or after `
    + `${publishedIso}. A print is the 1m candle open, or a captured cohort fill price when no candle `
    + `exists, searched up to ${PRICE_SEARCH_MIN} minutes past each instant; equal prices resolve `
    + `INCORRECT, and a missing print at either instant resolves UNRESOLVABLE with no Brier score. `
    + `Basis: the /api/pulse snapshot computed ${computedAt}, in which the tracked cohort's rolling-24h `
    + `${coin} flow was net ${netFlow >= 0 ? 'long' : 'short'} ${usd(netFlow)} on ${usd(notional)} of `
    + `notional across ${wallets} active wallets (${skewPct.toFixed(1)}% of notional directed `
    + `${netFlow >= 0 ? 'long' : 'short'}).`

  return {
    published_at: publishedIso,
    kind: 'cohort_signal',
    subject,
    claim,
    confidence: Number(confidence),
    provenance: {
      engine: 'ledger-cohort-signal@1.0.0',
      source: '/api/pulse',
      snapshot: {
        computed_at: computedAt,               // matview refresh time
        active_wallets: wallets,
        notional_usd: Math.round(notional),
        net_flow_usd: Math.round(netFlow),
        skew_pct: Number(skewPct.toFixed(2)),
        long_pct: snapshot?.longPct ?? null,
        long_pct_change: snapshot?.longPctChange ?? null,
      },
      coverage: snapshot?.coverage ?? null,
      ...(analysis ? { selection_analysis: analysis } : {}),
    },
    horizon_hours: Number(horizonHours),
    resolves_at: resolvesAt,
  }
}

/**
 * Publish one cohort_signal. Idempotent on (coin, snapshot refresh time): the
 * pulse matview refreshes on a schedule, so re-running this against the same
 * snapshot must not mint a second call for the same reading. A genuinely new
 * call needs a genuinely new snapshot.
 *
 * @returns {{published: boolean, call?: object, reasons?: string[]}}
 */
export async function publishCohortSignal(input, { log = () => {}, db = sb } = {}) {
  const row = cohortSignalCall(input)
  const computedAt = row.provenance.snapshot.computed_at

  const existing = await db(
    'ledger_calls?select=id&kind=eq.cohort_signal'
    + `&subject->>coin=eq.${encodeURIComponent(row.subject.coin)}`
    + `&provenance->snapshot->>computed_at=eq.${encodeURIComponent(computedAt)}`
    + '&order=id.asc&limit=1',
  )
  if (existing?.length) {
    log(`${row.subject.coin} signal from snapshot ${computedAt} already published as call ${existing[0].id}`
      + ' — skipping (one call per snapshot)')
    return { published: false, reasons: [`snapshot already published as call ${existing[0].id}`] }
  }

  const [call] = await db('ledger_calls', {
    method: 'POST',
    prefer: 'return=representation',
    body: [row],
  })

  log(`published Ledger call ${call.id}: ${row.subject.coin} ${row.subject.direction}`
    + ` @ ${row.confidence} — resolves ${row.resolves_at}`)
  await announceCall(call, { log }).catch((e) => log(`telegram announce failed: ${e.message}`))
  return { published: true, call }
}
