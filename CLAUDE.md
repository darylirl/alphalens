# CLAUDE.md

Project guidance for AI coding sessions in this repository.

## Rules for all sessions

These are non-negotiable and apply to every code path, service, script, and
migration in this repo.

### 1. Every PostgREST read must be explicitly paginated or bounded

Supabase's PostgREST layer **silently truncates responses at ~1,000 rows**. It
does not error, it does not set a flag the callers were reading — it just
returns a short array that looks like a complete result set. This has caused
**two production bugs** already (a coin universe computed from an arbitrary
1,000-row slice of `fills`, and a cohort aggregation that under-counted without
anyone noticing).

Therefore:

- Never issue a `select` whose result size you have not bounded. Either pass an
  explicit `limit` you know is smaller than the cap and you *intend* as a cap
  (with an `order` that makes the slice meaningful), or page with
  `limit`/`offset` until a short page comes back (see `sbPageAll` in
  `capture-service/index.mjs` and `pageAll` in `verify-service/db.mjs`).
- Never aggregate client-side over an unbounded table read. Push the aggregate
  into SQL (a view, a materialized view, or an RPC) and read the small result.
- An unordered query without a limit is doubly wrong: the ~1,000 rows you get
  back are an arbitrary slice, not the first or the latest.

### 2. The friction floors may never be reduced in any code path

Every replay, backtest, verification, or simulation applies **at least**:

| Friction | Floor |
| --- | --- |
| Decision-to-fill delay | **60 s** |
| Adverse slippage | **5 bps** |
| Taker fee | **0.045 % per side** |

Higher (more pessimistic) values are always allowed and are sometimes
requested. Lower values are rejected — not clamped, not warned about,
**rejected** — at validation time, and the floors are additionally enforced as
database `CHECK` constraints on persisted results
(`supabase/migrations/010_verify.sql`). Do not add a "no-friction" mode, a
"gross returns" toggle, or a test fixture that bypasses them: a number produced
without these frictions is not a result, and there is no code path in which it
is acceptable to produce one.

### 3. Missing data is never zero

An absent row means *we do not know*, not *nothing happened*. The two are
opposite claims and only one of them is honest.

This is not hypothetical: the hourly cohort aggregate
(`cohort_flow_hourly`) was partially built during development, and a
zero-filling rolling window replayed those un-built hours as genuine
"cohort net flow went flat" readings — manufacturing entry signals out of an
outage. The strategy would have looked tradeable because the outage looked
like data.

Therefore, anywhere a series is assembled from stored aggregates:

- Track coverage **explicitly and separately from the values**. For
  `cohort_flow_hourly` the ground truth is "the aggregate holds a row for ANY
  coin in that hour" — the build is global per hour, so a coin missing from a
  covered hour genuinely did not trade, while an hour missing entirely was
  never computed.
- A rolling window that touches an uncovered point returns `null`, never `0`.
  `null` must propagate through rule evaluation (Kleene logic) so it cannot
  fire anything — reading it as `false` is the same bug wearing a different
  hat.
- When coverage has holes, narrow the served window to the longest contiguous
  covered run and **report what was dropped** in `data_coverage`. Silently
  spanning a gap is the failure this rule exists to prevent.
- The same applies to any completeness claim about a recent window: fills for
  a period still being backfilled are not a complete picture of that period,
  and a wallet count that collapses is the signal that a window is damaged
  rather than quiet.
