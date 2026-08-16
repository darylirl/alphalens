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
