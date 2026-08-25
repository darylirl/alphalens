# Verification runs

Artifacts from end-to-end runs of the database verification surface. Each
result also lives as an append-only row in `verification_results` (the
`trg_verification_results_append_only` trigger rejects UPDATE and DELETE).

## Job 2 — 60-day BTC cohort net-flow cross, 2026-06-16 to 2026-08-15

- Hypothesis: when the 24h rolling cohort net flow into BTC crosses above
  zero, going long for 6h is profitable after realistic frictions
  (60s delay, 5 bps slippage, 0.045% taker fee per side, 1000 USD fixed size).
- Signal series: `cohort_flow_series('BTC', ...)` — 1440/1440 hours covered,
  zero uncovered buckets (missing data is never zero; the rule cannot fire
  on or across a NULL bucket).
- Execution prices: Hyperliquid 1h candle opens (1453 bars, gap-free).
  Realized delay is 60s to 1h, at or above the 60s friction floor, declared
  in `data_coverage.granularity_mix`.
- Result: 63 trades, net -78.53 USD (gross -21.84, fees -56.69),
  win rate 47.6%, profit factor 0.66, max drawdown 81.58 USD.
- Verdict: **killed** (kill criterion `unprofitable`: net_pnl_usd <= 0).
  `too_few_trades` passed (63 >= 10).
- Files: `e2e_engine_job2.py` (engine), `trades_job2.csv` (all 63 trades),
  `result_job2.json` (spec, metrics, verdict, data coverage as written to
  `verification_results` id=1).

A killed verdict is a valid, kept outcome: the point of the verification
surface is to record what the data says, not what we hoped it would say.
