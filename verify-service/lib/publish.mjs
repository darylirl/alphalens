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
