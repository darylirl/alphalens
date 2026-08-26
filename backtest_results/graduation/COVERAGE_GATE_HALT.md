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

---

## Addendum, 2026-08-26: this report's root cause was incomplete

The heading above ("Why the S3 archive was not used") named one cause. There
were two, and only the second one is mine to have caught.

**1. No credentials in the run container.** True as written, and still true:
`.env.local` is gitignored, so it never reached the fresh clone, and the
default credential chain finds nothing here — no env keys, no
`~/.aws/credentials`, and IMDS answers 403, so there is no instance role
either. Every AWS call from this container fails before it can list anything.

**2. The prefix in `s3_backfill.py` was wrong.** The real layout carries an
`hourly/` segment — `node_fills/hourly/{ymd}/{H}.lz4`, not
`node_fills/{ymd}/`. On a machine that *does* have credentials, every LIST
succeeded and correctly returned zero objects, which is indistinguishable from
a dead bucket unless you check the layout against the archive. `node_fills` is
also the legacy dataset and stops at 2025-07-27; `node_fills_by_block` carries
the tape from that day to the present, and the script could not target it at
all.

Cause 2 was a defect in code I wrote, and it would have produced a false
"archive empty" result even with working credentials. The archive was never
unreachable in the general sense this report implied; it was unreachable *from
here*, and mis-addressed everywhere. Fixed in d2a9f24. The real extent,
verified by listing:

| dataset | range | days | objects | size |
| --- | --- | --- | --- | --- |
| `node_fills` | 2025-05-25 .. 2025-07-27 | 64 | 1,507 | 29.63 GiB |
| `node_fills_by_block` | 2025-07-27 .. 2026-08-25 | 395 | 9,467 | 242.61 GiB |
| union | 2025-05-25 .. 2026-08-25 | 458, zero gaps | 10,974 | 272.24 GiB |

Three further defects in the read path, all in code that had never run against
real archive bytes, were fixed in bc33fa7: an archive line is a two-element
array `[address, fill]` rather than a dict, so `_normalise_s3_fill` raised on
it; whole-object decompression held both the compressed object and its full
expansion in memory; and the two datasets overlap on 2025-07-27, so reading
both without de-duplicating on `tid` double-counts every fill that day.

`test_s3_archive_shape.py` now exercises all four against real lz4 objects in
the real directory layout. The original 13 tests passed throughout, because
every one of them stubbed the archive — they tested the assumptions, not the
tape.

**What does not change:** the gate result. 0 qualifying decision dates against
the 12 required, on the classified cohort over API-retention data. The archive
union above starts 2025-05-25, which is a materially deeper window than the
run had, so re-running the gate against a populated cache is a genuinely open
question rather than a foregone one — it has not been run.

**Cost note.** At 272.24 GiB the egress-priced estimate is $24.51, which is
within $0.49 of the $25 fence and above the USD 5-to-20 range section 7
pre-registers. But S3 to EC2 *in the same region* is $0.00/GB, and this
archive is in ap-northeast-1: run in-region, the same transfer costs $0.0046
in request charges. The estimator assumed internet egress unconditionally and
would have refused, or alarmed about, a nearly free transfer. It now takes
`--transfer in-region` and prints both figures, defaulting to egress so that
it can never understate.
