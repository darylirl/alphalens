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
