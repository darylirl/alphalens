# MERIT P0 Backtest Specification, v1.2
## The graduated-book test: does process-based selection beat passive capital?

Version 1.2, 26 August 2026. Owner: Daryl Lim. Supersedes v1.0. All figures USD. Nothing here is investment, financial or legal advice.

---

## 0. Change log (v1.0 to v1.2), pre-registered before any verdict exists

**Why this amendment is legitimate:** no run has produced a verdict. v1.0's coverage gate halted before the headline run, exactly as designed, and the committed diagnostic (backtest_results/graduation/coverage.csv, 28 decision dates) showed the reason: the 9-month window held a mean of 3.7 eligible wallets per date, and v1.0's binary gates produced zero graduations everywhere, with failure broad-based across all five criteria (exposure 85%, drawdown 67%, sizing 39%, post-loss 24%, liquidation 15% of eligible wallet-dates). A test that can only return an empty book answers nothing. Two changes follow, each with its reason on the record:

**Change 1: binary gates become a continuous score.** v1.0's pass/fail cliffs contradicted the MERIT handoff's own eval principle 4 ("continuous capital curve, no pass/fail cliff; allocation is a monotonic function of risk-adjusted score"). v1.2 aligns the test with the product's actual mechanism: wallets are ranked by a composite process score and the book funds the top of the ranking, score-weighted. The five process dimensions are unchanged; only their aggregation changes from gates to a curve.

**Change 2: full universe, full window.** v1.0 ran on the classified cohort over a 9-month verified window. v1.2 requires the S3 archive backfill and the full wallet universe meeting the eligibility floor, because G0 scores observable behavior, not our labels, and because the venture question deserves statistical power.

**What did NOT change, and may not change:** the four kill criteria (section 6), the walk-forward look-ahead protocol, the eligibility floor, survivorship inclusion, capacity haircuts, the HLP benchmark, and the priority order (kill criteria first, dataset capture always, money layer last). Any further amendment before the binding run requires another change-log entry here; after the binding run, the spec is frozen and the verdict stands.

## 1. What this test decides

Unchanged from v1.0: the venture-level kill criterion from the MERIT handoff. If a book of wallets selected on process quality cannot beat passive HLP exposure risk-adjusted, with lower drawdown, MERIT's selection thesis fails and the funding ladder does not get built. The hypothesis, causal form: traders ranked highly on repeatable process discipline (drawdown control, sizing consistency, post-loss composure, exposure management, liquidation avoidance) will, as a diversified score-weighted book, outperform passive exposure on a risk-adjusted basis, because process persists where returns-based rankings select luck. Our published research (the copy-trading autopsy) proved the null for returns-based selection. This test measures whether process-based selection does better.

This remains an allocation test, not a copy test: book returns are the wallets' own realized returns scaled to allocation. The relevant integrity constraints are look-ahead prevention, survivorship inclusion, capacity honesty, and selection made strictly from information available at decision time.

## 2. The process score S (replaces v1.0's G0 gates)

At each decision date T, every wallet passing the eligibility floor receives a score built from the same five dimensions as v1.0, each measured continuously over the trailing 60-day window using only data at or before T:

1. **Drawdown control** d1: max intra-window equity drawdown as a fraction of window-start equity. Lower is better.
2. **Sizing consistency** d2: coefficient of variation of per-trade open notional. Lower is better.
3. **Post-loss composure** d3: median size of the 3 trades following a losing close, divided by window-median size. Values at or below 1.0 are best; escalation above 1.0 is penalized.
4. **Exposure management** d4: the window's maximum single-position entry notional as a fraction of equity at entry. Lower is better.
5. **Liquidation avoidance** d5: liquidation events in the window (0 or more). Fewer is better; any liquidation is heavily penalized but not disqualifying by itself.

**Aggregation, fixed before the run:** each dimension is converted to a cross-sectional percentile rank among that decision date's eligible wallets (rank ascending so that better behavior means a higher percentile), then S = mean of the five percentiles, equally weighted. Percentile ranking is deliberately parameter-free: it removes every tunable threshold that v1.0 contained, which is the strongest available defense against calibration fishing. Ties broken by longer verified history. No returns, PnL, Sharpe, or win-rate term appears anywhere in S. That absence is the experiment.

**Eligibility floor (unchanged from v1.0):** at least 60 resolved round-trip trades in the window; active on at least 30 distinct days; verified complete history over the window per start_position validation, else excluded and logged, never guessed.

## 3. Walk-forward protocol (unchanged mechanics, wider data)

Monthly decision dates across the longest verified-contiguous window the S3-backfilled data supports, targeting the archive's full depth (3 years where servable). At each T: score eligible wallets; the book for the forward 90-day funded window is the **top quintile by S** (see section 4); wallets are re-scored at every subsequent T and drop out of the book when they leave the top quintile, effective at that T only. Blown-up wallets contribute their losses until removal or final trade, whichever is first. Survivorship included by construction.

## 4. Book construction

**Selection: top 20 percent of eligible wallets by S at each T, with an absolute cap of 50 wallets** (largest-S first) so the book stays auditable. **Weighting: proportional to S within the selected set**, subject to the per-wallet cap of 5 percent of book. Cash earns zero. Capacity haircut unchanged: any wallet whose window median daily traded notional exceeds USD 5M contributes returns haircut by 25 percent, disclosed per wallet. Book returns computed from wallets' own equity histories (accountValueHistory where servable, else fills reconstruction with completeness validation), penny-reconciled.

**Breadth floor for a meaningful book (feeds kill criterion 3):** a decision date with fewer than 25 eligible wallets scores the date but marks it under-powered; the walk-forward headline uses only dates meeting the floor, and the count of excluded dates is reported.

## 5. Benchmark

Unchanged: HLP vault performance over the identical calendar windows, same accounting, both series gross of fund fees. No cherry-picked start dates.

## 6. Kill criteria (unchanged from v1.0, binding)

The venture test FAILS, and MERIT stops per the handoff, unless ALL hold on the headline configuration:

1. Book deflated Sharpe strictly greater than HLP Sharpe over the full walk-forward period, with deflation accounting for every configuration examined across the robustness battery.
2. Book maximum drawdown strictly lower than HLP maximum drawdown over the same period.
3. Breadth: the headline walk-forward averages at least 15 wallets in the book across qualifying decision dates, and at least 12 qualifying decision dates exist. Below either, the verdict is INCONCLUSIVE, never PASS.
4. Robustness: the sign of the Sharpe advantage survives (a) removal of the single best wallet-period, (b) first-half versus second-half split, (c) selection at top 10 percent and top 30 percent instead of 20, (d) equal-weight instead of S-weighted allocation. A result that flips on any of these is curve fitting: verdict FAIL.

Additionally reported, not gating: book alpha versus BTC; the rank correlation between S at T and forward 90-day risk-adjusted return (the direct measurement of whether process predicts performance, and the first entry in MERIT's predictive-validity dataset); and the same correlation for a trailing-Sharpe ranking, as the published foil.

## 7. Data protocol: the S3 backfill (new, binding architecture)

The run requires the Hyperliquid S3 archive (requester-pays; AWS credentials in .env.local, read-only IAM user, USD 25/month budget lockout armed).

**Architecture rule, non-negotiable:** archive data is downloaded once to a local cache directory (s3_cache/, gitignored), decompressed and consumed locally by the backtest. **Nothing from the archive is bulk-loaded into Supabase.** The hot database receives only: run results, the coverage report, and per-period book CSVs (also written to backtest_results/graduation/). Heavy analytics never lives in the hot database; a full-universe multi-year ingest would also exceed the 16GB disk. The backfill script prints its estimated transfer cost before the full download and requires --confirm to proceed past the estimate; expected range USD 5 to 20, hard-fenced by the AWS budget action regardless.

Coverage gate, restated for the wider data: the run reports eligible counts per decision date and the verified window before executing; if the S3-backed window still cannot produce at least 12 qualifying decision dates, stop and report rather than degrade.

## 8. Implementation route

backtest_graduation.py evolves to v1.2: the gate logic becomes the scoring pipeline of section 2, the S3 cache reader is added, everything else (completeness validation, exclusion logging, penny reconciliation, HLP caching, walk-forward engine) carries over. Same invariants as backtest_copy.py throughout. The spec, kill criteria, and verdict publish to the Ledger as a hypothesis_verdict call under the standard publishing rule, with per-period book CSVs as receipts. The v1.0-to-v1.2 change log (section 0) is part of the published record.

## 9. Outputs

The verdict block against the four criteria with the LOW-POWER/INCONCLUSIVE machinery of sections 4 and 6; book versus HLP equity curves; per-date eligible counts and score distributions; per-wallet contribution table with haircuts and exclusions; the robustness battery table; the S-to-forward-performance rank correlation alongside the trailing-Sharpe foil; and the per-window outcome distribution that seeds MERIT's actuarial loss dataset.
