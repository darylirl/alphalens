/**
 * Cohort-signal floors and the concentration reader.
 *
 * Split out of publish.mjs for the same reason grammar.mjs is split out of
 * spec.mjs: publish.mjs reaches node:crypto through spec.mjs, and the /admin
 * console has to evaluate these floors in the browser. This module has no
 * platform imports, so the form and the publisher share one definition of
 * every floor instead of drifting copies.
 *
 * publish.mjs re-exports everything here, so existing importers are unchanged.
 */

/** Floors below which a skew is not a signal. Guardrails, not preferences. */
export const SIGNAL_MIN_WALLETS = 3
export const SIGNAL_MIN_SKEW_PCT = 5
export const SIGNAL_MIN_NOTIONAL_USD = 250_000

/**
 * Concentration floors — pre-registered 2026-08-27, before any cohort_signal
 * was published, so no call has ever been made under a looser rule.
 *
 * The first candidate to clear skew, notional and wallet count was HYPE at
 * -62.2% skew on $3.9M across 7 wallets, of which one wallet held roughly two
 * thirds of the short opens. Every existing floor passed and the reading was
 * still one trader's position, not cohort conviction. Skew measures how
 * lopsided the book is; these measure how many hands made it that way.
 *
 * A cohort_signal claims the COHORT is positioned. If one wallet can move the
 * number, the claim is about that wallet, and the honest thing is to not make
 * it.
 */
export const SIGNAL_MIN_PARTICIPATING_WALLETS = 10
export const SIGNAL_MAX_WALLET_CONCENTRATION_PCT = 40

export const usd = (n) => `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`

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
/**
 * Read the concentration block for one direction out of a /api/pulse snapshot.
 *
 * Returns `{measured: false, why}` whenever the reading is absent or unusable
 * rather than substituting a value. The three ways it can be unmeasured are
 * all real: the deployed matview predates migration 024 and has no
 * concentration columns; the API could not compute a share; or nothing traded
 * in that direction at all, which leaves the share undefined rather than 0%.
 *
 * @param {object} snapshot  the /api/pulse coin row
 * @param {'up'|'down'} direction
 */
export function concentrationFor(snapshot, direction) {
  const block = snapshot?.concentration
  if (!block || typeof block !== 'object') {
    return { measured: false, why: 'no concentration block on the snapshot — matview predates migration 024' }
  }
  const side = direction === 'up' ? block.long : block.short
  if (!side || typeof side !== 'object') {
    return { measured: false, why: `no "${direction === 'up' ? 'long' : 'short'}" side in the concentration block` }
  }

  const directionalNotionalUsd = Number(side.notionalUsd)
  const wallets = Number(side.wallets)
  const topWalletNotionalUsd = Number(side.topWalletNotionalUsd)
  if (!Number.isFinite(directionalNotionalUsd) || !Number.isFinite(wallets) || !Number.isFinite(topWalletNotionalUsd)) {
    return { measured: false, why: 'concentration fields are not all numbers' }
  }
  if (directionalNotionalUsd <= 0) {
    // A share of nothing is not 0% — it does not exist. Saying 0% here would
    // report the most permissive possible answer for the least evidence.
    return { measured: false, why: `no notional was directed ${direction === 'up' ? 'long' : 'short'} in the window` }
  }

  return {
    measured: true,
    directionalNotionalUsd,
    wallets,
    topWalletNotionalUsd,
    topWalletSharePct: (topWalletNotionalUsd / directionalNotionalUsd) * 100,
  }
}

