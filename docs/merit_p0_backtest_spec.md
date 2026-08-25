# MERIT P0 Backtest Specification
## The graduated-book test: does process-based selection beat passive capital?

Version 1.0, 25 August 2026. Owner: Daryl Lim. Resolves open question 1 of the MERIT handoff. All figures USD. Nothing here is investment, financial or legal advice.

---

## 1. What this test decides

The MERIT handoff pre-registers one kill criterion for the entire venture: **if the backtested graduated book cannot beat HLP risk-adjusted, with lower drawdown, stop.** This document defines that test precisely enough that the result is binding, using the discipline AlphaLens already proved: hypothesis stated before the run, frictions and exclusions explicit, kill criteria evaluated by the engine rather than by hope.

The hypothesis, stated causally: wallets selected on **process quality** (drawdown discipline, sizing consistency, post-loss behavior) rather than trailing returns will, as a diversified book, deliver better risk-adjusted forward performance than passive HLP exposure, because process metrics measure repeatable behavior while trailing returns measure mostly luck and regime. Our own run 2 proved the null for return-based selection: trailing Sharpe anti-selects. MERIT's premise is that process metrics do better. That premise has never been tested. This test does it.

Important framing: this is not a copy-trading test. The book does not mirror trades with delay and slippage. It simulates being the capital behind the wallets, so book returns are the wallets' own realized returns scaled to allocation. The frictions that matter here are selection honesty, look-ahead prevention, survivorship inclusion, and capacity haircuts, not execution latency.

## 2. The graduation template G0 (the retroactive eval proxy)

A wallet graduates at decision time T if, computed strictly from data available at or before T over the trailing 60-day eval window, all of the following hold:

**Eligibility floor.** At least 60 resolved round-trip trades in the window; active on at least 30 distinct days; verified complete history over the window per the start_position validation, else excluded and logged, never guessed.

**Process criteria (the actual eval).**
1. Drawdown discipline: max equity drawdown within the window at most 15 percent of window-start equity.
2. Sizing consistency: coefficient of variation of per-trade notional at most 1.5, computed on opens only.
3. Post-loss behavior: median position size in the 3 trades following a losing close at most 1.3x the wallet's window-median size. This is the revenge-sizing gate.
4. Exposure discipline: no single open position exceeding 40 percent of equity at entry during the window.
5. Kill-style survivorship inside the window: no liquidation events in the window (historicalOrders liquidatedCanceled or equivalent).

**Explicitly absent from G0: any profit target, any Sharpe threshold, any PnL rank.** Returns enter only through the risk lens above. This is the point of the test. If process selection cannot work without smuggling returns back in, MERIT's eval thesis is false and we want to know.

G0's thresholds are the pre-registered defaults. The robustness battery perturbs them; the headline result uses these numbers.

## 3. Walk-forward protocol (look-ahead prevention)

Monthly decision dates T1..Tn across the longest honest window the data supports. At each T: score all eligible wallets on G0 using only data at or before T; graduated wallets form the book for the forward 90-day funded window; wallets are re-evaluated at every subsequent T (perpetual recertification proxy), and a wallet failing G0 at any later T is removed from the book at that T, not retroactively.

Blown-up wallets stay in the record: a graduated wallet that dies mid-window contributes its losses to the book until removal at the next T or its final trade, whichever is first. Survivorship is included by construction, never filtered.

## 4. Book construction

Equal-weight across graduated wallets at each T, per-wallet cap 5 percent of book, cash earns zero. Book return per period is the allocation-weighted sum of wallets' own equity-curve returns (from portfolio accountValueHistory where servable, else reconstructed from fills with the standard completeness validation). Capacity haircut: any wallet whose window median daily traded notional exceeds USD 5M contributes returns haircut by 25 percent, disclosed per wallet, because small-wallet returns do not scale to funded size. Correlation cap deferred to a robustness variant rather than the headline (v0 keeps the model simple and disclosed).

## 5. Benchmark

HLP over the identical calendar windows, from public vault performance history. Same period, same accounting, no cherry-picked start dates. Both series reported gross of any fund fees, since the kill test compares capital deployment quality, not fee structures.

## 6. Kill criteria (pre-registered, binding)

The venture test FAILS, and MERIT stops per the handoff, unless ALL of the following hold on the headline configuration:

1. Book deflated Sharpe strictly greater than HLP Sharpe over the full walk-forward period. Deflation accounts for the number of graduation-threshold configurations examined across the robustness battery.
2. Book maximum drawdown strictly lower than HLP maximum drawdown over the same period.
3. Breadth: the book averages at least 15 graduated wallets across decision dates. Below that, the verdict is INCONCLUSIVE, not PASS: a thin book proves nothing about an underwriting business.
4. Robustness: the sign of the Sharpe advantage survives (a) removal of the single best wallet-period, (b) first-half versus second-half split, and (c) G0 thresholds perturbed by plus and minus 20 percent each, one at a time. A result that flips on any of these is curve fitting, verdict FAIL.

Additionally reported, not gating: alpha of the book versus a simple market factor (BTC), so a pass driven purely by beta-in-a-bull-window is visible and named.

## 7. Data constraints, stated before running

The handoff assumes 3 years of history. Our verified store supports less: replayable complete histories in the cohort run 94 to 955 days, and the S3 deep backfill was deliberately deferred. Protocol: the test runs on the longest verified-contiguous window the data honestly supports, reported prominently; if that window is under 18 months, the verdict carries an explicit LOW-POWER flag and the S3 backfill (Option 3, previously deferred, roughly USD 5 and an AWS account) becomes the prerequisite for a binding verdict. We do not stretch thin data into a confident answer. Missing data is never zero.

## 8. Implementation route

A standalone research script in the repo, backtest_graduation.py, sibling to backtest_copy.py, same invariants enforced: completeness validation, exclusion logging, penny reconciliation of book accounting, per-wallet source disclosure. Not forced through the verify-service rule grammar (allocation books are outside grammar v1); instead the run's spec, kill criteria, and verdict are published to the Ledger as a hypothesis_verdict call under the standard publishing rule, with the per-period book CSV as the receipt. If MERIT proceeds, a later grammar version absorbs allocation specs; for P0, honest research code beats premature productization.

## 9. Outputs

One report: headline verdict against the four kill criteria; book versus HLP equity curves; per-decision-date graduation counts; per-wallet contribution table with capacity haircuts and exclusions; robustness battery table; the LOW-POWER flag state; and the Ledger call id once published. Plus the actuarial seed: the per-window distribution of graduated-wallet outcomes, which is the first row of the loss dataset the handoff names as MERIT's crown jewel, captured from test one as instructed.

## 10. Claude Code prompt (run in the alphalens repo, one session, after current PRs merge)

"Build backtest_graduation.py implementing the MERIT P0 spec at docs/merit_p0_backtest_spec.md exactly. Read the spec first and treat its G0 thresholds, walk-forward protocol, book construction, kill criteria, and data-constraint rules as binding. Reuse the fills store, completeness validation, and candle ladder from backtest_copy.py. Before the full run, print the honest data coverage report (eligible wallet count per decision date, longest verified-contiguous window) and stop for my confirmation if the window is under 18 months. Then run headline plus the full robustness battery, write per-period book CSVs to backtest_results/graduation/, and print the verdict block evaluating all four kill criteria. Do not optimize anything. HLP benchmark series from the public vault history endpoints, cached locally. All PostgREST reads paginated. Report the verdict verbatim."

---

*Priority order unchanged from the handoff: kill criteria first, dataset capture always, money layer last. If this test says stop, MERIT stops, and the result publishes to the Ledger like every other honest no.*
