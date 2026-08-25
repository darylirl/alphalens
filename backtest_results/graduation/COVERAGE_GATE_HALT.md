# MERIT P0 v1.2 — coverage gate halt

**Status: STOPPED at the spec section 7 coverage gate. No verdict was produced,
and none should be inferred.**

Run: `python3 backtest_graduation.py --universe classified --coverage-only`,
2026-08-25, 541 wallets, 3,285 s.

## The gate

Spec section 7: *"if the S3-backed window still cannot produce at least 12
qualifying decision dates, stop and report rather than degrade."* Section 4
defines a qualifying date as one with at least 25 eligible wallets.

| | |
| --- | --- |
| Decision dates examined | 32 (2023-12-01 → 2026-07-01) |
| Qualifying dates (≥25 eligible) | **0** |
| Longest contiguous qualifying run | **0** |
| Required by the gate | 12 |
| Best single date | 2026-07-01, **20 eligible** of 222 active |
| Mean eligible across all dates | 3.5 |

Per-date detail: `coverage.csv`. Per-date exclusion reasons:
`coverage_exclusion_reasons.csv`.

## Why the S3 archive was not used

The archive is unreachable from the run environment. Spec section 7 places the
read-only IAM credentials in `.env.local`; that file is gitignored
(`.gitignore` line 22, `.env*.local`), so it exists on the operator's machine
and not in a fresh clone. The only AWS values present were proxy placeholders,
which AWS rejects:

```
STS  GetCallerIdentity → InvalidClientTokenId
S3   ListObjectsV2     → InvalidAccessKeyId   (both buckets, ap-northeast-1 and us-east-1)
```

`s3_backfill.py` refuses to spend or to write a partial cache in that state, so
`s3_cache/` is empty and the walk-forward window is bounded by the `/info`
API's retention instead. This is reported rather than worked around.

## Why a wider universe would not rescue the gate

The universe run was the classified cohort (541 wallets), not the full 7,045
that v1.2 section 0 change 2 requires: without the archive, wallet history must
come from the `/info` API one wallet at a time, and the full universe is a
~12-hour crawl at the API's rate ceiling. That narrowing is a real limitation
and is stated here rather than buried.

It is, however, not the binding constraint. The exclusion breakdown shows the
gate fails on **history depth, not universe width**:

| decision | active | truncated history | no equity anchor | anchor <$1k | below floor | eligible |
| --- | --- | --- | --- | --- | --- | --- |
| 2025-10-01 | 41 | 10 | 12 | 6 | 9 | 4 |
| 2026-01-01 | 77 | 19 | 16 | 25 | 9 | 8 |
| 2026-04-01 | 119 | 24 | 42 | 21 | 21 | 11 |
| 2026-07-01 | 223 | 38 | 89 | 53 | 23 | 20 |

Two things follow. First, `fills_fetch_incomplete` is **0 at every date** — the
API served complete fills for every wallet it served at all, so the losses are
not a paging artifact. Second, the `active` column collapses going backwards:
only 28 of the 541 most-active wallets in the database have any evaluable
window at 2025-08-01, and 2 are eligible. Twelve *contiguous* qualifying dates
would require 25 eligible wallets at every month back to roughly 2025-08.
Adding the ~6,500 unclassified wallets — which are less active than the
classified cohort by construction — cannot supply that at dates where the
history itself does not exist.

The archive is what fixes this, exactly as section 7 says: `node_fills` carries
complete per-wallet history at archive depth, which both removes the 38
truncated-history exclusions and extends the `active` column back through the
window v1.2 was written to test.

## What is needed to proceed

Working AWS credentials for the read-only IAM user, at which point
`s3_backfill.py --dataset node_fills --start ... --end ...` prints its cost
estimate, `--confirm` transfers, and the gate is re-run against archive depth.

Nothing in this run was degraded, padded, or narrowed to produce a number.
