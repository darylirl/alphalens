# AlphaLens — repo guidance

## Honesty contract (applies to everything)

No invented trading data anywhere, ever. Every number shown to a user or
written to the database traces to a real source (Hyperliquid fills, captured
candles, a completed backtest) or is an honest empty state. Timestamps are
never synthesized against `Date.now()` to simulate recency. Schematic visuals
are captioned "Illustration".

## Invariant: missing data is never zero

A gap in captured data must never be read, stored, or displayed as `0`.
Zero is a real measurement ("capture was healthy and nothing happened");
a missing bucket is the absence of measurement. Concretely:

- `cohort_flow_series(coin, from, to)` is the canonical way to read the
  cohort flow series. It returns one row per hour with `covered boolean`:
  `covered = false` hours have NULL values, and a rule evaluator (e.g.
  `cross_above` on `net_flow`) must not fire on, or across, a NULL bucket.
  Never build a contiguous series by joining `cohort_flow_hourly` against a
  time grid and coalescing absent rows to 0 — absent can mean either "no
  fills for this coin" (true zero, only when the hour is covered) or
  "capture was down" (missing, must stay NULL).
- `verify_tape_prices(coin, from, to)` returns only real captured 1m candle
  rows; minutes that were not captured are absent from the result and must
  not be interpolated into fake prices.
- Rolling aggregates (e.g. a 24h net-flow sum) are undefined if any bucket
  in their lookback is uncovered; propagate NULL instead of skipping or
  zero-filling the gap.
- Any backtest or verification result must declare its actual data coverage
  in `data_coverage` (window served, granularity mix, source mix, excluded
  pairs) rather than silently narrowing or padding the requested window.

## Database verification surface (Supabase, project qrmekrpeoijzprsriaux)

- `verification_jobs` (status: queued → running → done | failed) is claimed
  via `claim_verification_job(worker)` (FOR UPDATE SKIP LOCKED on queued).
- `verification_results` is append-only, enforced by the
  `trg_verification_results_append_only` trigger; a wrong result is never
  edited — re-run the spec to produce a new row.
- Result rows are shape-checked by CHECK constraints (`verify_spec_ok`,
  `verify_coverage_ok`, `verify_metrics_ok`, `verify_verdict_ok`) and
  friction floors (`verify_frictions_ok`: delay ≥ 60s, slippage ≥ 5 bps,
  taker fee ≥ 0.045%). Never weaken these floors.
- `cohort_flow_hourly` is rebuilt with `cohort_flow_rebuild(from, to)`
  (idempotent delete+insert per hour range) and backfilled in paced steps via
  `cohort_flow_backfill_slice`. Keep rebuild chunks small (a few hours) and
  sequential — a previous unpaced refresh schedule saturated the production
  database.

## Capacity budget: capture scope

Disk growth is bounded by an enforced mechanism, not a number in a doc:
`wallets.capture_enabled` (migration 011, default false) marks the wallets
the daemon captures — the classified cohort (`archetype not null`) plus any
wallet referenced by an active signal or a verification job spec. The
capture daemon defaults to `SWEEP_SCOPE=cohort` and reads only
`capture_enabled` wallets for both WS subscriptions and the rotating sweep;
`SWEEP_SCOPE=all` is an explicit, deliberate override. Context: sweeping all
~7,000 tracked wallets grew `fills` (3.8GB) by 4-10GB/month. When adding
wallets to capture, set the flag — never widen the daemon's query. Existing
out-of-scope fills are kept, never deleted.

## Operational notes

- The Supabase Management API caps `statement_timeout` at the outer
  statement; long refreshes belong in `pg_cron`, not RPC.
- PostgREST caps responses near 1000 rows — paginate, never assume a full
  result set.
- After DDL, run `notify pgrst, 'reload schema'`.
