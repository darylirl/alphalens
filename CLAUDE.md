# AlphaLens — repo guidance

## Honesty contract (applies to everything)

No invented trading data anywhere, ever. Every number shown to a user or
written to the database traces to a real source (Hyperliquid fills, captured
candles, a completed backtest) or is an honest empty state. Timestamps are
never synthesized against `Date.now()` to simulate recency. Schematic visuals
are captioned "Illustration".

## Rules

Done means merged to the default branch, deployed, and verified against
production; completion may never be reported on preview evidence.

The ~1,000-row PostgREST cap applies to RPC responses too — a function asked
for 30,000 rows returns 1,000 silently; return bulk data as a single jsonb row
with an explicit total so truncation is declared, never inferred.

## Invariant: missing data is never zero

A gap in captured data must never be read, stored, or displayed as `0`.
Zero is a real measurement ("capture was healthy and nothing happened");
a missing bucket is the absence of measurement. The two are opposite claims
and only one of them is honest.

This is not hypothetical: the hourly cohort aggregate was partially built
during development, and a zero-filling rolling window replayed those un-built
hours as genuine "cohort net flow went flat" readings — manufacturing entry
signals out of an outage. The strategy looked tradeable because the outage
looked like data.

Concretely:

- Track coverage **explicitly and separately from the values**. The ground
  truth for `cohort_flow_hourly` is "the aggregate holds a row for ANY coin in
  that hour" — the build is global per hour, so a coin missing from a covered
  hour genuinely did not trade, while an hour missing entirely was never
  computed. Two readers implement this: `cohort_flow_series(coin, from, to)`
  returns one row per hour with `covered boolean` (uncovered hours carry NULL
  values), and `verify-service` loads the covered-hour set from
  `cohort_flow_coverage_hours(from, to)`.
- Never build a contiguous series by joining `cohort_flow_hourly` against a
  time grid and coalescing absent rows to 0.
- Rolling aggregates (e.g. a 24h net-flow sum) are undefined if any bucket in
  their lookback is uncovered: propagate NULL rather than skipping or
  zero-filling. NULL must flow through rule evaluation as Kleene logic so it
  cannot fire anything — reading it as `false` is the same bug wearing a
  different hat.
- Where coverage has holes, narrow the served window to the longest contiguous
  covered run and **report what was dropped** in `data_coverage`. Silently
  spanning a gap is the failure this rule exists to prevent.
- Any backtest or verification result must declare its actual data coverage in
  `data_coverage` (window served, granularity mix, source mix, excluded pairs)
  rather than silently narrowing or padding the requested window.
- The same applies to any completeness claim about a recent window: fills for a
  period still being backfilled are not a complete picture of that period, and
  a collapsing wallet count is the signal that a window is damaged rather than
  quiet.

## Invariant: the friction floors may never be reduced

Every replay, backtest, verification, or simulation applies **at least**:

| Friction | Floor |
| --- | --- |
| Decision-to-fill delay | **60 s** |
| Adverse slippage | **5 bps** |
| Taker fee | **0.045 % per side** |

Higher (more pessimistic) values are always allowed and are sometimes
requested. Lower values are rejected — not clamped, not warned about,
**rejected** — at validation time, and enforced again as a database `CHECK`
(`verify_frictions_ok`). Do not add a "no-friction" mode, a "gross returns"
toggle, or a test fixture that bypasses them: a number produced without these
frictions is not a result, and there is no code path in which it is acceptable
to produce one.

## Invariant: every PostgREST read is explicitly paginated or bounded

Supabase's PostgREST layer **silently truncates responses at ~1,000 rows**. It
does not error and it sets no flag — it just returns a short array that looks
like a complete result set. This has caused **two production bugs** (a coin
universe computed from an arbitrary 1,000-row slice of `fills`, and a cohort
aggregation that under-counted unnoticed).

- Never issue a `select` whose result size you have not bounded. Either pass an
  explicit `limit` you know is under the cap and *intend* as a cap (with an
  `order` that makes the slice meaningful), or page with `limit`/`offset` until
  a short page comes back (`sbPageAll` in `capture-service/index.mjs`,
  `pageAll` in `verify-service/lib/db.mjs`).
- Never aggregate client-side over an unbounded table read. Push the aggregate
  into SQL (a view, a materialized view, or an RPC) and read the small result.
- An unordered query without a limit is doubly wrong: the ~1,000 rows returned
  are an arbitrary slice, not the first or the latest.

## Database verification surface (Supabase, project qrmekrpeoijzprsriaux)

- `verification_jobs` (status: queued → running → done | failed) is claimed via
  `claim_verification_job(worker)` (FOR UPDATE SKIP LOCKED on queued).
- `verification_results` is append-only, enforced by the
  `trg_verification_results_append_only` trigger AND by revoking
  UPDATE/DELETE/TRUNCATE from every role; a wrong result is never edited —
  re-run the spec to produce a new row.
- Result rows are shape-checked by CHECK constraints (`verify_spec_ok`,
  `verify_coverage_ok`, `verify_metrics_ok`, `verify_verdict_ok`) and friction
  floors (`verify_frictions_ok`). Never weaken these.
- `cohort_flow_hourly` is rebuilt with `cohort_flow_rebuild(from, to)`
  (idempotent delete+insert per hour range) and backfilled in paced steps via
  `cohort_flow_backfill_slice`, guarded by `cohort_flow_backfill_claim` so two
  runners cannot advance the same slice.
- `ledger_calls` (migration 015) is the public Ledger: append-only with the
  same enforcement as `verification_results`, plus one carved-out door — a
  column-level grant lets the scorer fill the resolution block
  (`resolved_at`, `outcome`, `scored_brier`, `resolution_evidence`) exactly
  once, validated by the trigger. Calls are strategy/cohort-level only
  (`ledger_subject_ok` rejects wallet-bearing subjects). Eligible
  verification results auto-publish via `verify-service/lib/publish.mjs`
  (runner at result time + scorer sweep; idempotent via the partial unique
  index on `provenance->result_id`). `cohort_signal` calls are scored by
  `verify-service/scorer.mjs` against captured tape, and a tape gap at
  either instant resolves as `unresolvable` with no Brier score — never a
  guessed price.
- Two tape readers exist and mean different things:
  `verify_tape_prices(coin, from, to, ...)` returns captured rows over a range;
  `verify_tape_prices_at(coin, targets[], search)` returns the first print at
  or after each of a known set of decision timestamps. Do not merge them
  without checking both callers.

## Publishing rule: what may reach the Ledger

`verify-service/` is the **canonical verification engine**. It owns the job
queue, the versioned spec schema, rule grammar v1, and the invariant tests.
`verification/` is an earlier standalone Python stack, kept as experimental
reference; new verification work goes in `verify-service/`.

A result is **Ledger-eligible** only when both hold:

1. It was produced by the canonical engine (`engine_version` starts
   `verify-engine@`), and
2. Its `spec` validates against the current grammar — `validateSpec()` accepts
   it unchanged, which means the spec is a spec the engine could re-run today.

Everything else is recorded but not published. That includes honest results
from the experimental stack: `verification_results` id=1 was written by
`e2e-runner-0.1.0` before grammar v1 existed, and its `spec` does not conform
(`{type: cross_above, series: cohort.net_flow_usd}` rather than
`{type: cohort, metric: net_flow_usd, op: cross_above}`); it also reports no
excluded pairs where the canonical engine finds 225 for BTC.

The row stays. `verification_results` is append-only on purpose, and removing
an honest measurement to tidy the record would be its own dishonesty — the
eligibility test is what keeps it out of anything user-facing, not deletion.
Filter on publish; never edit or delete history.

## Capacity budget: capture scope

Disk growth is bounded by an enforced mechanism, not a number in a doc:
`wallets.capture_enabled` (default false) marks the wallets the daemon
captures — the classified cohort (`archetype not null`) plus any wallet
referenced by an active signal or a verification job spec. The capture daemon
defaults to `SWEEP_SCOPE=cohort` and reads only `capture_enabled` wallets for
both WS subscriptions and the rotating sweep; `SWEEP_SCOPE=all` is an explicit,
deliberate override. Context: sweeping all ~7,000 tracked wallets grew `fills`
(3.8GB) by 4-10GB/month. When adding wallets to capture, set the flag — never
widen the daemon's query. Existing out-of-scope fills are kept, never deleted.

## Operational notes

- **Heavy aggregation does not belong in `pg_cron`.** Rebuilding
  `cohort_flow_hourly` over `fills` is IO-bound and grows with capture volume;
  four backfill slices on a two-minute cron saturated this instance so
  completely that PostgREST stopped answering and the capture daemon lost
  writes for the better part of an hour, and the schedule could not be removed
  because removing it needed a connection. Backfills run from
  `verify-service/backfill.mjs`: one slice at a time, lease-guarded,
  self-paced, and killable. Keep `pg_cron` for cheap bounded refreshes only,
  and respect the project's 30-minute floor for those.
- The Supabase Management API caps `statement_timeout` at the outer statement;
  a function-level `SET` cannot extend a timer that has already started.
- PostgREST caps responses near 1000 rows — paginate, never assume a full
  result set.
- After DDL, run `notify pgrst, 'reload schema'`.
