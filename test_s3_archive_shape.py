#!/usr/bin/env python3
"""
test_s3_archive_shape.py — the archive READ path, against real lz4 bytes.

Why this file exists: the S3 read path shipped with 13 passing tests and four
bugs in it, because every one of those tests stubbed the archive. They
validated the assumptions rather than the layout, so a record shape that was
wrong in three independent ways still went green. These tests build actual
lz4-compressed objects in the real directory layout and read them back through
the real functions.

Covers the four defects fixed in bc33fa7 / d2a9f24:
  1. a record is a two-element ARRAY [address, fill], not a dict;
  2. node_fills_by_block wraps a block's fills in a block envelope;
  3. the two datasets overlap on the seam day and must de-duplicate on tid;
  4. the cache's day component moved when the prefix gained hourly/.

Run: python3 test_s3_archive_shape.py
"""
import json
import shutil
from pathlib import Path

import lz4.frame

import backtest_graduation as G

TMP = Path("/tmp/claude-0/-home-user-alphalens/"
           "99b06e49-603f-5d42-8237-2c8a04fc343a/scratchpad/archive_shape_test")

fails = []


def check(name, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f"  — {detail}" if detail else ""))
    if not cond:
        fails.append(name)


def fill(tid, addr="0xaaa", coin="BTC", t=1_700_000_000_000, px="50000",
         sz="0.5", side="B", **kw):
    f = {"coin": coin, "px": px, "sz": sz, "side": side, "time": t,
         "startPosition": "0.0", "closedPnl": "12.5", "fee": "1.1", "tid": tid}
    f.update(kw)
    return [addr, f]


def block(*fills, number=676647375, t="2025-07-27T10:00:00.000000000"):
    """One node_fills_by_block line, in the shape the real archive uses:
    {local_time, block_time, block_number, events: [[address, fill], ...]}.
    Verified against s3://hl-mainnet-node-data/node_fills_by_block/hourly/."""
    return {"local_time": t, "block_time": t, "block_number": number,
            "events": list(fills)}


def write_lz4(path: Path, lines):
    path.parent.mkdir(parents=True, exist_ok=True)
    with lz4.frame.open(path, "wb") as fh:
        for ln in lines:
            fh.write((json.dumps(ln) + "\n").encode())


def main():
    print("archive read path, real lz4 bytes\n")
    if TMP.exists():
        shutil.rmtree(TMP)

    SEAM_T = 1_753_600_000_000          # a time inside the seam day
    # Legacy dataset: one line per fill, [address, fill].
    write_lz4(TMP / "node_fills" / "hourly" / "20250727" / "0.lz4", [
        fill(1001, t=SEAM_T),
        fill(1002, t=SEAM_T + 1000, addr="0xBBB"),      # mixed case on purpose
        fill(1003, t=SEAM_T + 2000, addr="0xzzz"),      # outside the universe
    ])
    # by_block dataset: a block envelope carrying its fills in `events`. It
    # repeats tid 1001 because the seam day exists in both datasets. The empty
    # block is the common real case — the venue produces blocks faster than
    # trades arrive — and must read as a measured zero, not a parse failure.
    write_lz4(TMP / "node_fills_by_block" / "hourly" / "20250727" / "0.lz4", [
        block(fill(1001, t=SEAM_T), fill(1004, t=SEAM_T + 3000), number=42),
        block(number=43),
    ])
    # A later by_block day, plus one malformed line.
    p = TMP / "node_fills_by_block" / "hourly" / "20250728" / "5.lz4"
    p.parent.mkdir(parents=True, exist_ok=True)
    with lz4.frame.open(p, "wb") as fh:
        fh.write((json.dumps(block(fill(1005, t=SEAM_T + 90_000_000),
                                   number=44)) + "\n").encode())
        fh.write(b"{not json at all\n")
        fh.write((json.dumps({"unexpected": "shape"}) + "\n").encode())

    orig = G.S3_CACHE
    G.S3_CACHE = TMP
    try:
        # ── 1. record shapes parse at all ──────────────────────────────────
        one = G._normalise_s3_fill(fill(1, t=1))
        check("two-element [address, fill] array parses",
              one is not None and one[0][0] == "0xaaa", f"{one}")
        blk = G._normalise_s3_fill(block(fill(2, t=1), fill(3, t=1)))
        check("by_block block envelope parses to every fill in events",
              blk is not None and len(blk) == 2, f"{blk if blk is None else len(blk)}")
        empty = G._normalise_s3_fill(block())
        check("a block with events: [] is a measured zero, not a parse failure",
              empty == [], f"{empty!r}")
        check("a dict record does not raise (legacy/envelope branch)",
              G._normalise_s3_fill({"nope": 1}) is None)
        check("an unrecognised shape returns None rather than raising",
              G._normalise_s3_fill(["only-one-element"]) is None)
        check("a bare string record returns None rather than raising",
              G._normalise_s3_fill("garbage") is None)

        # ── 2. end-to-end read over real bytes ────────────────────────────
        universe = {"0xaaa", "0xbbb"}
        got = G.load_s3_fills(universe, 0, 9_999_999_999_999)
        tids_a = [f for f in got.get("0xaaa", [])]
        check("reads both datasets from the hourly/ layout",
              set(got) == {"0xaaa", "0xbbb"}, f"addresses={sorted(got)}")
        check("seam-day duplicate (tid 1001) is counted once, not twice",
              len(tids_a) == 3, f"0xaaa fills={len(tids_a)} (expect 1001,1004,1005)")
        check("address filtering drops out-of-universe wallets",
              "0xzzz" not in got)
        check("address matching is case-insensitive",
              len(got.get("0xbbb", [])) == 1, f"{len(got.get('0xbbb', []))}")
        check("fills come back in time order",
              all(a["time"] <= b["time"] for a, b in zip(tids_a, tids_a[1:])))
        check("fill fields survive the round trip",
              tids_a[0]["coin"] == "BTC" and tids_a[0]["closedPnl"] == "12.5"
              and tids_a[0]["liq"] is False)

        # ── 3. time-window bounding ───────────────────────────────────────
        narrow = G.load_s3_fills(universe, SEAM_T, SEAM_T + 2000)
        check("time window bounds the read",
              len(narrow.get("0xaaa", [])) == 1,
              f"{len(narrow.get('0xaaa', []))} in a 2s window")

        # ── 4. cache state locates days by shape, not position ────────────
        st = G.s3_cache_state()
        check("cache state sees the cache as present", st["present"])
        nf = st["datasets"].get("node_fills_by_block", {})
        check("day component found under the hourly/ segment",
              nf.get("days") == 2, f"days={nf.get('days')} (expect 2)")
        check("day range reported from the real path",
              nf.get("first_day") == "20250727" and nf.get("last_day") == "20250728",
              f"{nf.get('first_day')}..{nf.get('last_day')}")

        # ── 5. an empty cache is absence, never zero activity ─────────────
        G.S3_CACHE = TMP / "does-not-exist"
        check("absent cache returns {} rather than a wallet that did not trade",
              G.load_s3_fills(universe, 0, 9e12) == {})
        check("absent cache reports present=False with a reason",
              G.s3_cache_state()["present"] is False
              and G.s3_cache_state()["reason"])
    finally:
        G.S3_CACHE = orig
        shutil.rmtree(TMP, ignore_errors=True)

    print(f"\n{'ALL PASS' if not fails else str(len(fails)) + ' FAILED: ' + ', '.join(fails)}")
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
