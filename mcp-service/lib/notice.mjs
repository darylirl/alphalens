/**
 * The envelope every tool result is wrapped in.
 *
 * The point of the envelope is that an agent cannot read a number out of this
 * server without also being handed what that number does and does not cover.
 * On the website the honesty strip sits next to the figure; here it travels in
 * the payload, because an agent will only ever see the payload.
 */

export const NOTICE =
  'Nothing served by AlphaLens is financial advice, a recommendation, or a signal to trade. ' +
  'AlphaLens publishes measurements and pre-registered verdicts — including the negative ones: ' +
  'we replayed 28,318 smart-money trades under honest frictions (60s decision delay, 5bps slippage, ' +
  '0.045% taker fee per side) and lost money, which is why the copy-trading product was deleted. ' +
  'Treat the data below as evidence to check, not as a position to take.'

/**
 * Wrap tool output. `data` is the answer, `coverage` states what was actually
 * measured, `caveats` are the specific things a reader would otherwise get
 * wrong, and `source` names the public endpoint the data came from so any
 * claim here can be re-fetched by hand.
 */
export function envelope({ data, coverage = {}, caveats = [], source }) {
  return {
    data,
    coverage,
    caveats,
    source,
    notice: NOTICE,
  }
}

/**
 * A missing measurement is never a zero and never a false. Both the app and
 * this server serve absence as null; this helper exists so the intent is
 * stated at every call site rather than assumed.
 */
export function nullish(v) {
  return v === undefined ? null : v
}
