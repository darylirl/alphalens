#!/usr/bin/env python3
"""
test_s3_backfill.py — proves the parts of s3_backfill.py that the spec's
section 7 makes binding, without touching AWS:

  * the cost estimate is computed from real listed object sizes;
  * --confirm is genuinely required before any object body is fetched;
  * the inner spend fence refuses a transfer above --max-usd;
  * days with zero objects are reported as gaps, never as zero activity;
  * a short download is discarded rather than cached as if complete.

Run: python3 test_s3_backfill.py
"""
import sys
from datetime import date
from pathlib import Path

import s3_backfill as S


class StubPaginator:
    def __init__(self, per_day):
        self.per_day = per_day

    def paginate(self, Bucket, Prefix, RequestPayer):          # noqa: N803
        ymd = Prefix.rstrip("/").split("/")[-1]
        objs = self.per_day.get(ymd, [])
        # two pages, to exercise the pagination loop
        yield {"Contents": [{"Key": f"{Prefix}{n}", "Size": sz}
                            for n, sz in objs[:1]]}
        if objs[1:]:
            yield {"Contents": [{"Key": f"{Prefix}{n}", "Size": sz}
                                for n, sz in objs[1:]]}


class StubClient:
    def __init__(self, per_day):
        self._p = StubPaginator(per_day)
        self.downloads = []

    def get_paginator(self, _op):
        return self._p

    def download_file(self, Bucket, Key, Filename, ExtraArgs):  # noqa: N803
        self.downloads.append(Key)
        Path(Filename).write_bytes(b"x" * 10)


fails = []


def check(name, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f"  — {detail}" if detail else ""))
    if not cond:
        fails.append(name)


def main():
    print("s3_backfill invariants\n")

    ds = S.DATASETS["node_fills"]
    per_day = {
        "20260801": [("a.lz4", 100 * S.GIB // 100), ("b.lz4", 50 * S.GIB // 100)],
        "20260802": [],                       # a genuine archive gap
        "20260803": [("c.lz4", 25 * S.GIB // 100)],
    }
    client = StubClient(per_day)
    objects, list_reqs, empty = S.list_dataset(
        client, ds, date(2026, 8, 1), date(2026, 8, 4), verbose=False)

    check("lists every object across pages", len(objects) == 3, f"got {len(objects)}")
    check("reports the empty day as a gap, not as zero activity",
          empty == ["20260802"], f"empty={empty}")
    check("counts list requests for billing", list_reqs >= 3, f"list_reqs={list_reqs}")

    est = S.estimate_cost(objects, list_reqs)
    expected_bytes = sum(sz for _, sz in objects)
    check("estimate uses real listed byte sizes",
          est["bytes"] == expected_bytes, f"{est['bytes']} vs {expected_bytes}")
    check("transfer cost = GiB x list price",
          abs(est["usd_transfer"] - est["gib"] * S.USD_PER_GB_TRANSFER) < 1e-12)
    check("request cost counts GETs and LISTs",
          abs(est["usd_requests"]
              - (len(objects) + list_reqs) / 1000.0 * S.USD_PER_1K_GET) < 1e-12)
    check("total = transfer + requests",
          abs(est["usd_total"] - (est["usd_transfer"] + est["usd_requests"])) < 1e-12,
          f"${est['usd_total']:.4f} for {est['gib']:.2f} GiB")

    # --confirm gate and spend fence, via main()'s own control flow.
    argv = sys.argv[:]
    orig_client, orig_cred = S.make_client, S.verify_credentials
    S.make_client = lambda region, env: client
    S.verify_credentials = lambda env: "OK: stub"
    try:
        sys.argv = ["s3_backfill.py", "--start", "2026-08-01", "--end", "2026-08-04"]
        rc = S.main()
        check("without --confirm: exits 0 and downloads nothing",
              rc == 0 and not client.downloads, f"rc={rc} downloads={len(client.downloads)}")

        sys.argv = ["s3_backfill.py", "--start", "2026-08-01", "--end", "2026-08-04",
                    "--confirm", "--max-usd", "0.0001"]
        rc = S.main()
        check("spend fence beats --confirm",
              rc == 4 and not client.downloads, f"rc={rc} downloads={len(client.downloads)}")

        S.CACHE = Path("/tmp/claude-0/-home-user-alphalens/"
                       "99b06e49-603f-5d42-8237-2c8a04fc343a/scratchpad/s3_cache_test")
        S.MANIFEST = S.CACHE / "manifest.json"
        sys.argv = ["s3_backfill.py", "--start", "2026-08-01", "--end", "2026-08-04",
                    "--confirm", "--max-usd", "25"]
        rc = S.main()
        check("with --confirm under the fence: transfers", rc == 0 and client.downloads,
              f"rc={rc} downloads={len(client.downloads)}")
        # every stub body is 10 bytes while the listing claims far more, so every
        # object must be rejected as short rather than cached.
        cached = [p for p in S.CACHE.rglob("*")
                  if p.is_file() and p.name != "manifest.json"]
        check("short downloads are discarded, never cached as complete",
              not cached, f"cached={[p.name for p in cached]}")
        check("no .part files left behind",
              not list(S.CACHE.rglob("*.part")))
    finally:
        sys.argv = argv
        S.make_client, S.verify_credentials = orig_client, orig_cred

    # Precise check: no Supabase *client* — no import, no project URL, no
    # PostgREST path, no service-role key. The word itself appears in the
    # file's own comments explaining why none of that is there.
    src = Path("s3_backfill.py").read_text()
    banned = ["rest/v1", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
              "SUPABASE_ANON_KEY", "supabase.co", "import supabase",
              "from supabase", "create_client"]
    hits = [b for b in banned if b in src]
    check("no Supabase client anywhere in the backfill path", not hits,
          f"hits={hits}" if hits
          else "no import, no project URL, no PostgREST path, no key")

    print(f"\n{'ALL PASS' if not fails else str(len(fails)) + ' FAILED: ' + ', '.join(fails)}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
