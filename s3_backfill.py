#!/usr/bin/env python3
"""
s3_backfill.py — Hyperliquid S3 archive backfill for the MERIT P0 run.

Implements docs/merit_p0_backtest_spec.md section 7 ("Data protocol: the S3
backfill"), which is binding architecture, not a suggestion:

  * The archive is requester-pays. Every request carries RequestPayer=requester
    and the caller is billed for GET requests and data transfer.
  * Archive data is downloaded ONCE into a local cache directory (s3_cache/,
    gitignored), decompressed and consumed locally by backtest_graduation.py.
  * NOTHING FROM THE ARCHIVE IS BULK-LOADED INTO SUPABASE. There is no
    Supabase client in this file and there must never be one. The hot database
    receives only run results, the coverage report and the per-period book
    CSVs, all written by backtest_graduation.py. A full-universe multi-year
    ingest would also exceed the project's 16GB disk.
  * The script prints its estimated transfer cost BEFORE the full download and
    refuses to proceed past the estimate without --confirm.

The cost estimate is computed from the actual byte sizes S3 reports in the
listing, not from a guess about how big the archive "should" be. Listing is
itself billable (LIST requests are charged like GETs on a requester-pays
bucket), but it is ~3 orders of magnitude cheaper than the transfer it is
sizing, and it is the only way to produce an honest number. If the estimate
exceeds --max-usd the script stops regardless of --confirm; the AWS budget
action is the outer fence, this is the inner one.

Usage:
  # 1. estimate only (default; no object bodies are downloaded)
  python3 s3_backfill.py --dataset node_fills --start 2023-08-01 --end 2026-08-01

  # 2. same command plus --confirm to actually transfer
  python3 s3_backfill.py --dataset node_fills --start 2023-08-01 --end 2026-08-01 --confirm

  # 3. what is actually in the cache
  python3 s3_backfill.py --status

Credentials: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY from the environment or
.env.local (read-only IAM user). The script validates them with STS before
spending anything, and reports honestly if they are absent or rejected rather
than emitting a partial cache that later looks like real coverage.
"""

import argparse
import json
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent
CACHE = REPO / "s3_cache"
MANIFEST = CACHE / "manifest.json"

# ── Archive layout ──────────────────────────────────────────────────────────
# Prefix templates are parameterised by UTC date and hour. The script does not
# assume these exist: it LISTS them and reports what it actually found, so a
# layout change surfaces as "0 objects" rather than as silent empty coverage.
DATASETS = {
    # Per-fill tape: address, coin, px, sz, side, time, startPosition,
    # closedPnl, fee, liquidation marker. This is the dataset the graduated-book
    # test needs — it is what makes per-wallet process metrics computable at
    # archive depth, where the /info API's retention runs out.
    "node_fills": {
        "bucket": "hl-mainnet-node-data",
        "region": "ap-northeast-1",
        "prefix": "node_fills/hourly/{ymd}/",
        "granularity": "day",
        "desc": "per-fill tape by hour (address, coin, px, sz, closedPnl, fee)",
    },
    # PRIMARY per-fill dataset. node_fills above is the legacy format and stops
    # at 2025-07-27; by_block picks up the same day and runs to the present, so
    # the two are contiguous rather than alternatives. Same hourly .lz4 layout.
    "node_fills_by_block": {
        "bucket": "hl-mainnet-node-data",
        "region": "ap-northeast-1",
        "prefix": "node_fills_by_block/hourly/{ymd}/",
        "granularity": "day",
        "desc": "per-fill tape by block, hourly (primary; supersedes node_fills)",
    },
    "node_trades": {
        "bucket": "hl-mainnet-node-data",
        "region": "ap-northeast-1",
        "prefix": "node_trades/hourly/{ymd}/",
        "granularity": "day",
        "desc": "public trade tape by hour",
    },
    # Daily per-asset context (mark/oracle/funding). Small; used for the
    # notional and equity anchors when reconstructing from fills.
    "asset_ctxs": {
        "bucket": "hyperliquid-archive",
        "region": "ap-northeast-1",
        "prefix": "asset_ctxs/{ymd}.csv.lz4",
        "granularity": "day-file",
        "desc": "daily per-asset context (mark, oracle, funding)",
    },
}

# AWS list prices, us/ap standard tiers, stated explicitly so the estimate is
# auditable and correctable rather than a magic number. Requester-pays means
# these land on our bill, not Hyperliquid's.
# Data transfer OUT of S3 to the internet, first 10TB/mo. This is the right
# number for a laptop or an out-of-region box, and the wrong one for the
# deployment this script actually runs in.
USD_PER_GB_EGRESS = 0.09
# S3 -> EC2 in the SAME region is $0.00/GB. The archive lives in
# ap-northeast-1 and the backfill runs in-region on an EC2 instance there, so
# the full 272 GiB union costs request charges and nothing else. Assuming
# egress unconditionally overstates that run by ~$24.50 — enough to trip the
# --max-usd fence and refuse a transfer that is very nearly free.
USD_PER_GB_IN_REGION = 0.0
USD_PER_1K_GET = 0.0004          # GET/LIST request charge
GIB = 1024 ** 3


def load_env() -> dict:
    """Same convention as backtest_graduation.py / backtest_copy.py."""
    env = dict(os.environ)
    for name in (".env.local", ".env"):
        p = REPO / name
        if p.exists():
            for line in p.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    env.setdefault(k.strip(), v.strip())
    return env


def require_boto3():
    try:
        import boto3  # noqa: F401
        from botocore.config import Config  # noqa: F401
    except ImportError:
        sys.exit("boto3 is required: pip3 install boto3 lz4")
    import boto3
    from botocore.config import Config
    return boto3, Config


def make_client(region: str, env: dict):
    """Explicit keys when present, otherwise boto3's default credential chain.

    On an EC2 instance with an attached role there are no keys to find and none
    should exist: the instance profile is delivered by IMDS and rotates on its
    own. Requiring explicit keys here would mean copying long-lived secrets onto
    a machine that already has better credentials, which is strictly worse than
    having none."""
    boto3, Config = require_boto3()
    cfg = Config(retries={"max_attempts": 4, "mode": "standard"},
                 connect_timeout=20, read_timeout=120,
                 max_pool_connections=16)
    key = env.get("AWS_ACCESS_KEY_ID", "")
    secret = env.get("AWS_SECRET_ACCESS_KEY", "")
    if key and secret:
        return boto3.client(
            "s3", region_name=region,
            aws_access_key_id=key, aws_secret_access_key=secret,
            aws_session_token=env.get("AWS_SESSION_TOKEN") or None, config=cfg)
    return boto3.client("s3", region_name=region, config=cfg)


def verify_credentials(env: dict) -> str:
    """Fail loudly and early, before a single billable object request."""
    boto3, Config = require_boto3()
    key = env.get("AWS_ACCESS_KEY_ID", "")
    secret = env.get("AWS_SECRET_ACCESS_KEY", "")
    cfg = Config(retries={"max_attempts": 2}, connect_timeout=15, read_timeout=25)
    try:
        if key and secret:
            sts = boto3.client(
                "sts", region_name="us-east-1",
                aws_access_key_id=key, aws_secret_access_key=secret,
                aws_session_token=env.get("AWS_SESSION_TOKEN") or None, config=cfg)
            source = "static keys"
        else:
            # Instance profile / default chain. Absent keys are not an error here.
            sts = boto3.client("sts", region_name="us-east-1", config=cfg)
            source = "default chain (instance profile)"
        ident = sts.get_caller_identity()
        return f"OK [{source}]: {ident.get('Arn')} (account {ident.get('Account')})"
    except Exception as exc:                                   # noqa: BLE001
        return f"REJECTED: {type(exc).__name__}: {str(exc)[:220]}"


def daterange(start: date, end: date):
    d = start
    while d < end:
        yield d
        d += timedelta(days=1)


def list_dataset(client, ds: dict, start: date, end: date, verbose: bool):
    """Enumerate objects in range. Returns (objects, list_requests, days_empty).

    objects is a list of (key, size_bytes). Days with no objects are counted
    and reported, never silently treated as days with no trading: a missing
    archive day is absence of measurement, not a measurement of zero.
    """
    objects, list_requests, empty_days = [], 0, []
    paginator = client.get_paginator("list_objects_v2")
    for d in daterange(start, end):
        ymd = d.strftime("%Y%m%d")
        prefix = ds["prefix"].format(ymd=ymd)
        found = 0
        try:
            for page in paginator.paginate(Bucket=ds["bucket"], Prefix=prefix,
                                           RequestPayer="requester"):
                list_requests += 1
                for obj in page.get("Contents", []) or []:
                    objects.append((obj["Key"], int(obj["Size"])))
                    found += 1
        except Exception as exc:                               # noqa: BLE001
            sys.exit(f"\nLIST failed at {prefix}: {type(exc).__name__}: "
                     f"{str(exc)[:220]}\nNothing was downloaded.")
        if found == 0:
            empty_days.append(ymd)
        if verbose:
            print(f"  {ymd}: {found:5d} objects", flush=True)
    return objects, list_requests, empty_days


def estimate_cost(objects, list_requests: int, in_region: bool = False) -> dict:
    """Cost of transferring the listed objects, from their real byte sizes.

    `in_region` selects the S3 -> EC2 same-region rate ($0.00/GB) over internet
    egress ($0.09/GB). It defaults to False so the estimate is never quiet
    about a cost that is real: understating spend is the failure that matters
    here, and an operator who is told $24 and pays $0 has lost nothing.
    Both figures are reported either way, so neither assumption can mislead."""
    total_bytes = sum(sz for _, sz in objects)
    gb = total_bytes / GIB
    rate = USD_PER_GB_IN_REGION if in_region else USD_PER_GB_EGRESS
    transfer = gb * rate
    gets = (len(objects) + list_requests) / 1000.0 * USD_PER_1K_GET
    return {
        "objects": len(objects),
        "list_requests": list_requests,
        "bytes": total_bytes,
        "gib": gb,
        "in_region": in_region,
        "usd_per_gb": rate,
        "usd_transfer": transfer,
        "usd_requests": gets,
        "usd_total": transfer + gets,
        # The counterfactual, always shown, so the assumption in force is
        # visible rather than buried in a constant.
        "usd_total_other": gb * (USD_PER_GB_EGRESS if in_region
                                 else USD_PER_GB_IN_REGION) + gets,
    }


def print_estimate(ds_name: str, ds: dict, start: date, end: date, est: dict,
                   empty_days: list, max_usd: float):
    print()
    print("=" * 72)
    print(f"  S3 BACKFILL COST ESTIMATE — dataset '{ds_name}' (requester-pays)")
    print("=" * 72)
    print(f"  bucket           s3://{ds['bucket']} ({ds['region']})")
    print(f"  prefix template  {ds['prefix']}")
    print(f"  window           {start.isoformat()} .. {end.isoformat()} "
          f"({(end - start).days} days)")
    print(f"  objects listed   {est['objects']:,}")
    print(f"  days with zero objects  {len(empty_days):,}"
          + (f"  (first: {empty_days[0]}, last: {empty_days[-1]})" if empty_days else ""))
    print(f"  transfer size    {est['gib']:.2f} GiB  ({est['bytes']:,} bytes)")
    print()
    mode = ("S3 -> EC2 same region" if est["in_region"]
            else "egress to internet")
    print(f"  transfer rate    ${est['usd_per_gb']}/GiB  ({mode})")
    print(f"  data transfer    {est['gib']:.2f} GiB x ${est['usd_per_gb']}/GiB "
          f"= ${est['usd_transfer']:.2f}")
    print(f"  requests         {est['objects'] + est['list_requests']:,} x "
          f"${USD_PER_1K_GET}/1k = ${est['usd_requests']:.4f}")
    print(f"  ESTIMATED TOTAL  ${est['usd_total']:.2f}")
    other = ("egress to internet" if est["in_region"]
             else "S3 -> EC2 same region")
    print(f"  if instead {other:<22} ${est['usd_total_other']:.2f}")
    print(f"  budget ceiling   ${max_usd:.2f} (inner fence; the AWS budget "
          f"action is the outer one)")
    print("=" * 72)
    if not est["in_region"] and est["usd_transfer"] > 1.0:
        print("  NOTE: this assumes egress to the internet. The archive is in")
        print("        ap-northeast-1; running the backfill on an EC2 instance")
        print("        in that region makes transfer free and leaves only the")
        print("        request charge. Pass --transfer in-region to price that.")
    if empty_days:
        print("  NOTE: days with zero objects are reported as gaps, not as days")
        print("        with no trading. The backtest treats them as uncovered.")
    print()


def download(client, ds: dict, objects, max_usd: float, est: dict):
    CACHE.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    done = skipped = 0
    bytes_pulled = 0
    t0 = time.monotonic()
    for i, (key, size) in enumerate(objects, 1):
        dest = CACHE / key
        # Resume: an object already cached at the exact byte size S3 reports is
        # not re-fetched. Size mismatch means a truncated earlier run: re-fetch.
        if dest.exists() and dest.stat().st_size == size:
            skipped += 1
            manifest[key] = {"size": size, "state": "cached"}
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(dest.suffix + ".part")
        try:
            client.download_file(ds["bucket"], key, str(tmp),
                                 ExtraArgs={"RequestPayer": "requester"})
        except Exception as exc:                               # noqa: BLE001
            tmp.unlink(missing_ok=True)
            print(f"\n  FAILED {key}: {type(exc).__name__}: {str(exc)[:160]}")
            manifest[key] = {"size": size, "state": "failed"}
            continue
        got = tmp.stat().st_size
        if got != size:
            # Never leave a short object in the cache pretending to be complete.
            tmp.unlink(missing_ok=True)
            manifest[key] = {"size": size, "state": "short"}
            print(f"\n  SHORT  {key}: got {got} of {size} bytes, discarded")
            continue
        tmp.rename(dest)
        manifest[key] = {"size": size, "state": "cached"}
        done += 1
        bytes_pulled += got
        if i % 50 == 0 or i == len(objects):
            rate = bytes_pulled / max(time.monotonic() - t0, 1e-9) / 1e6
            print(f"  [{i:,}/{len(objects):,}] fetched={done:,} cached={skipped:,} "
                  f"{bytes_pulled / GIB:.2f} GiB  {rate:.1f} MB/s", flush=True)
    MANIFEST.write_text(json.dumps(manifest, indent=1, sort_keys=True))
    print(f"\n  downloaded {done:,} objects ({bytes_pulled / GIB:.2f} GiB), "
          f"{skipped:,} already cached")
    print(f"  cache: {CACHE}")
    print("  Supabase received nothing from this run, by design (spec section 7).")


def status():
    if not CACHE.exists():
        print(f"No cache at {CACHE}. Nothing has been backfilled.")
        return
    files = [p for p in CACHE.rglob("*") if p.is_file() and p.name != "manifest.json"]
    total = sum(p.stat().st_size for p in files)
    print(f"cache dir : {CACHE}")
    print(f"objects   : {len(files):,}")
    print(f"size      : {total / GIB:.2f} GiB")
    by_ds = {}
    for p in files:
        top = p.relative_to(CACHE).parts[0]
        by_ds[top] = by_ds.get(top, 0) + p.stat().st_size
    for k, v in sorted(by_ds.items()):
        print(f"  {k:<20} {v / GIB:8.2f} GiB")


def main():
    ap = argparse.ArgumentParser(
        description="Hyperliquid S3 archive backfill (spec section 7). "
                    "Estimates cost first; --confirm is required to transfer.")
    ap.add_argument("--dataset", default="node_fills", choices=sorted(DATASETS))
    ap.add_argument("--start", default="2023-08-01", help="UTC start date (inclusive)")
    ap.add_argument("--end", default=None, help="UTC end date (exclusive); default today")
    ap.add_argument("--confirm", action="store_true",
                    help="proceed past the estimate and actually transfer")
    ap.add_argument("--max-usd", type=float, default=25.0,
                    help="inner spend fence; refuses to transfer above this")
    ap.add_argument("--transfer", choices=("egress", "in-region"),
                    default="egress",
                    help="transfer pricing. 'egress' ($0.09/GiB, the default, "
                         "never understates) or 'in-region' ($0.00/GiB, "
                         "correct when running on EC2 in the bucket's region "
                         "-- ap-northeast-1 for this archive)")
    ap.add_argument("--status", action="store_true", help="report the local cache and exit")
    ap.add_argument("--check-credentials", action="store_true",
                    help="validate AWS credentials and exit (no billable calls)")
    ap.add_argument("--verbose", action="store_true", help="per-day listing progress")
    args = ap.parse_args()

    if args.status:
        status()
        return 0

    env = load_env()
    cred = verify_credentials(env)
    print(f"AWS credentials: {cred}")
    if args.check_credentials:
        return 0 if cred.startswith("OK") else 2
    if not cred.startswith("OK"):
        print()
        print("Cannot reach the requester-pays archive without valid credentials.")
        print("Spec section 7 expects them in .env.local (read-only IAM user,")
        print("USD 25/month budget lockout armed). Nothing was listed or")
        print("downloaded, and no partial cache was written.")
        return 2

    ds = DATASETS[args.dataset]
    start = datetime.strptime(args.start, "%Y-%m-%d").date()
    end = (datetime.strptime(args.end, "%Y-%m-%d").date() if args.end
           else datetime.now(timezone.utc).date())
    if end <= start:
        sys.exit("--end must be after --start")

    client = make_client(ds["region"], env)
    print(f"\nListing s3://{ds['bucket']}/{ds['prefix'].format(ymd='YYYYMMDD')} "
          f"over {(end - start).days} days ({ds['desc']})...")
    objects, list_reqs, empty_days = list_dataset(client, ds, start, end, args.verbose)

    if not objects:
        print("\nNo objects found in the requested window. Reporting the empty")
        print("result rather than proceeding: an archive that lists nothing is a")
        print("gap to investigate, not a window with no trading.")
        return 3

    est = estimate_cost(objects, list_reqs, in_region=(args.transfer == "in-region"))
    print_estimate(args.dataset, ds, start, end, est, empty_days, args.max_usd)

    if est["usd_total"] > args.max_usd:
        print(f"REFUSING: estimated ${est['usd_total']:.2f} exceeds the "
              f"${args.max_usd:.2f} ceiling.")
        print("Narrow --start/--end or raise --max-usd deliberately.")
        return 4

    if not args.confirm:
        print("Estimate only. Nothing has been downloaded.")
        print("Re-run the identical command with --confirm to transfer.")
        return 0

    print(f"--confirm given; transferring {est['gib']:.2f} GiB to {CACHE}/ ...\n")
    download(client, ds, objects, args.max_usd, est)
    return 0


if __name__ == "__main__":
    sys.exit(main())
