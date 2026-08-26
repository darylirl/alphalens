#!/usr/bin/env python3
"""
s3_stream.py — the archive read path that fits in a small box's RAM.

Why this exists, measured rather than asserted: load_s3_fills() returns
{address: [fill, ...]}, so it retains the entire filtered tape. Against the
real 7,057-wallet universe over the 458-day union that is 1.28 billion fills
at a measured 645 bytes each — 769 GiB, or 538 GiB with market makers
excluded. The in-region box has 15 GiB. Streaming decompression fixed how
objects are *read*; it never addressed what is *kept*.

The old loader stays in backtest_graduation.py for lineage. This module is the
replacement path, built to be provably equivalent rather than plausibly so:

  * StreamingWalletData subclasses WalletData and does NOT call its __init__.
    It sets the same attributes, then INHERITS metrics_at() and
    period_return() untouched. The five dimension values and every downstream
    score run through the identical code, so equivalence has to be shown only
    for the attributes, never re-argued for the metrics.

  * Nothing is ever materialised per wallet. The archive is spilled to
    per-(dataset, wallet) files, each written in true chronological order, and
    read back as a lazy k-way merge with the API tape. A list() anywhere in
    that path would reinstate the 87 GiB peak the heaviest wallet represents.

  * fill_times / fill_pnl_net become array('q') / array('d') — 8 bytes per
    element against ~32 for a Python list, and bisect, slicing and sum() all
    behave identically on them.

  * Round trips ARE retained, in full and per coin. Measured on real archive
    bytes they are 0.75% of fills (8.7M over the union, ~0.3 GiB), and cv and
    postloss_ratio need exact medians over them. Approximating those with
    running moments would move the fifth decimal, and the equivalence protocol
    allows no such tolerance.

  * Trip ordering is reproduced exactly. WalletData iterates by_coin in
    insertion order (first appearance in the time-sorted fills) appending trips
    per coin, then sorts by close_ts. Python's sort is stable, so ties keep
    that coin-grouped order; this module collects trips per coin and
    concatenates in the same first-appearance order before the same sort.
    Anything else could reorder equal close_ts and shift the post-loss pool.

Two details are load-bearing and deliberate. The spill stores exactly the
nine-key dict the old loader built, including its omission of feeToken, which
makes fee_usd() treat archive fees as USDC. And seam de-duplication is scoped
to the days both datasets actually cover: a global `seen` set over 1.28 billion
fills would cost more than the fills it guards.
"""

import heapq
import json
import sys
from array import array
from collections import defaultdict
from pathlib import Path

import backtest_graduation as G


SPILL_SUFFIX = ".jsonl.lz4"


def _lz4():
    try:
        import lz4.frame
    except ImportError:
        sys.exit("python-lz4 is required: pip3 install lz4")
    return lz4.frame


def spill_path(spill_dir: Path, dataset: str, address: str) -> Path:
    """Per-dataset, two-level fan-out so no directory holds every wallet."""
    a = address.lower()
    return spill_dir / dataset / a[2:4] / (a + SPILL_SUFFIX)


def _chrono_key(path: Path, root: Path):
    """Sort archive objects into true time order.

    Path order is NOT time order: hour files sort lexicographically, so
    '10.lz4' precedes '2.lz4'. Spilling in path order would leave every
    wallet's file unsorted, and sorting it afterwards means holding the wallet
    in memory — the exact cost this module exists to avoid.
    """
    rel = path.relative_to(root).parts
    day = next((s for s in rel if len(s) == 8 and s.isdigit()), "")
    stem = path.name.split(".")[0]
    hour = int(stem) if stem.isdigit() else -1
    return (day, hour, path.name)


def dataset_days(cache_root: Path, dataset: str) -> set:
    root = cache_root / dataset
    if not root.exists():
        return set()
    days = set()
    for p in root.rglob("*.lz4"):
        for seg in p.relative_to(root).parts:
            s = seg.split(".")[0]
            if len(s) == 8 and s.isdigit():
                days.add(s)
                break
    return days


class _SpillWriter:
    """Buffered per-wallet appender.

    Files are opened, written and closed in batches rather than held open:
    7,057 concurrent lz4 frames would cost more memory than the fills they
    replace. Each flush writes an independent frame, which lz4.frame reads
    back transparently as a concatenated stream.
    """

    def __init__(self, spill_dir: Path, dataset: str, flush_every: int = 250_000):
        self.dir = spill_dir
        self.dataset = dataset
        self.buf: dict = defaultdict(list)
        self.pending = 0
        self.flush_every = flush_every

    def add(self, address: str, fill: dict):
        self.buf[address].append(json.dumps(fill, separators=(",", ":")))
        self.pending += 1
        if self.pending >= self.flush_every:
            self.flush()

    def flush(self):
        if not self.pending:
            return
        frame = _lz4()
        for addr, lines in self.buf.items():
            p = spill_path(self.dir, self.dataset, addr)
            p.parent.mkdir(parents=True, exist_ok=True)
            with frame.open(p, "ab") as fh:
                fh.write(("\n".join(lines) + "\n").encode())
        self.buf.clear()
        self.pending = 0


def spill_archive(addresses: set, spill_dir: Path, start_ms: int, end_ms: int,
                  cache_root: Path = None, progress_every: int = 250) -> dict:
    """One pass over the archive cache, writing per-(dataset, wallet) spills.

    Produces exactly the records load_s3_fills() would have kept — same address
    filter, same time bounds, same nine-key shape, same seam de-duplication on
    the venue trade id — but on disk, in chronological order, instead of in RAM.
    """
    frame = _lz4()
    cache_root = cache_root or G.S3_CACHE
    present = [d for d in G.S3_FILL_DATASETS if (cache_root / d).exists()]
    if not present:
        return {"objects": 0, "kept": 0, "bad": 0, "seam_dupes": 0, "datasets": []}

    # Seam scope: only days covered by more than one dataset can duplicate, so
    # only those need a `seen` set. Over the real union that is a single day.
    day_counts: dict = defaultdict(int)
    for d in present:
        for day in dataset_days(cache_root, d):
            day_counts[day] += 1
    seam_days = {d for d, n in day_counts.items() if n > 1}

    kept = bad = dupes = 0
    total_objs = 0
    seen: set = set()
    for dataset in present:
        root = cache_root / dataset
        objects = sorted((p for p in root.rglob("*.lz4") if p.is_file()),
                         key=lambda p: _chrono_key(p, root))
        total_objs += len(objects)
        writer = _SpillWriter(spill_dir, dataset)
        for n, path in enumerate(objects, 1):
            in_seam = path.parent.name in seam_days
            try:
                with frame.open(path, "rb") as fh:
                    for raw in fh:
                        line = raw.strip()
                        if not line:
                            continue
                        try:
                            rec = json.loads(line)
                        except json.JSONDecodeError:
                            bad += 1
                            continue
                        pairs = G._normalise_s3_fill(rec)
                        if pairs is None:
                            bad += 1
                            continue
                        for user, f in pairs:
                            if not user:
                                continue
                            u = user.lower()
                            if u not in addresses:
                                continue
                            t = int(f["time"])
                            if not (start_ms <= t <= end_ms):
                                continue
                            if in_seam:
                                tid = f.get("tid")
                                key = ((u, "tid", tid) if tid is not None else
                                       (u, t, f["coin"], str(f["px"]),
                                        str(f["sz"]), f["side"]))
                                if key in seen:
                                    dupes += 1
                                    continue
                                seen.add(key)
                            writer.add(u, {
                                "time": t, "coin": f["coin"], "px": f["px"],
                                "sz": f["sz"], "side": f["side"],
                                "startPosition": f.get("startPosition"),
                                "closedPnl": f.get("closedPnl"),
                                "fee": f.get("fee"),
                                "liq": bool(f.get("liquidation")
                                            or f.get("liquidationMarkPx")),
                            })
                            kept += 1
            except OSError as exc:
                sys.exit(f"Corrupt archive object {path}: {type(exc).__name__}: "
                         f"{exc}. Re-run s3_backfill.py rather than skipping it.")
            if n % progress_every == 0 or n == len(objects):
                print(f"  spill[{dataset}]: {n}/{len(objects)} objects, "
                      f"{kept:,} fills, {dupes:,} seam dupes", flush=True)
        writer.flush()
    if bad:
        print(f"  spill: WARNING {bad:,} archive lines could not be parsed as fills")
    return {"objects": total_objs, "kept": kept, "bad": bad,
            "seam_dupes": dupes, "datasets": present,
            "seam_days": sorted(seam_days)}


def iter_spill(spill_dir: Path, dataset: str, address: str):
    """Yield one wallet's fills for one dataset, in the order written, which
    spill_archive() guarantees is chronological."""
    p = spill_path(spill_dir, dataset, address)
    if not p.exists():
        return
    frame = _lz4()
    with frame.open(p, "rb") as fh:
        for raw in fh:
            line = raw.strip()
            if line:
                yield json.loads(line)


def merged_fills(spill_dir: Path, address: str, api_fills: list,
                 datasets=None):
    """Lazy k-way merge of the API tape and each dataset's spill, in time order.

    Reproduces merge_fills(): the API tape wins, and an archive fill matching
    one on (time, coin, px, sz, side) is dropped rather than double-counted.
    Nothing here builds a list, so peak memory is one fill, not one wallet.
    """
    datasets = datasets or G.S3_FILL_DATASETS
    api_sorted = sorted(api_fills or [], key=lambda f: f["time"])
    seen = {(f["time"], f["coin"], str(f["px"]), str(f["sz"]), f["side"])
            for f in api_sorted}

    def archive_stream(ds):
        for f in iter_spill(spill_dir, ds, address):
            k = (f["time"], f["coin"], str(f["px"]), str(f["sz"]), f["side"])
            if k not in seen:
                yield f

    streams = [iter(api_sorted)] + [archive_stream(d) for d in datasets]
    return heapq.merge(*streams, key=lambda f: f["time"])


class StreamingWalletData(G.WalletData):
    """Same attributes as WalletData, built without holding the fills.

    Deliberately does not call super().__init__. metrics_at() and
    period_return() are inherited unchanged, so the five dimensions and every
    downstream score are computed by the identical code.
    """

    def __init__(self, address: str, archetype: str, fills_factory,
                 complete: bool, portfolio: dict):
        self.address = address
        self.archetype = archetype
        self.fetch_complete = complete
        self.avh = G.SampledSeries(G.splice_perp_series(portfolio, "avh", align=False))
        self.pnl = G.SampledSeries(G.splice_perp_series(portfolio, "pnl", align=True))

        # ── pass 1: coin order of first appearance, and each coin's first fill
        # startPosition. WalletData derives truncated_coins from by_coin before
        # any trip is reconstructed, so it must be known up front here too.
        coin_first: dict = {}
        n_fills = 0
        for f in fills_factory():
            if G.is_spot(f["coin"]):
                continue
            n_fills += 1
            if f["coin"] not in coin_first:
                coin_first[f["coin"]] = f.get("startPosition")
        self.truncated_coins = {
            c for c, sp in coin_first.items()
            if abs(float(sp or 0)) > G.POSITION_EPS}
        self.n_fills = n_fills

        # ── pass 2: the arrays ──────────────────────────────────────────────
        self.fill_times = array("q")
        self.fill_pnl_net = array("d")
        self.liq_times: list = []
        self.trunc_fill_times: list = []
        self.exp_times: list = []
        self.exp_fracs: list = []
        day_notional: dict = defaultdict(float)
        trips_by_coin: dict = defaultdict(list)
        pos_by_coin: dict = defaultdict(float)
        cur_by_coin: dict = {}
        self.first_ts = self.last_ts = None

        for f in fills_factory():
            coin = f["coin"]
            if G.is_spot(coin):
                continue
            t = f["time"]
            if self.first_ts is None:
                self.first_ts = t
            self.last_ts = t
            pnl_net = float(f.get("closedPnl") or 0) - G.fee_usd(f)
            self.fill_times.append(t)
            self.fill_pnl_net.append(pnl_net)
            if f["liq"]:
                self.liq_times.append(t)
            sz = float(f["sz"])
            px = float(f["px"])
            day_notional[t // G.DAY_MS] += abs(sz) * px
            if coin in self.truncated_coins:
                self.trunc_fill_times.append(t)
                continue                    # trips only over complete coins

            delta = sz if f["side"] == "B" else -sz
            reported = f.get("startPosition")
            prev = float(reported) if reported is not None else pos_by_coin[coin]
            new = prev + delta
            pos_by_coin[coin] = 0.0 if abs(new) < G.POSITION_EPS else new
            prev_flat = abs(prev) < G.POSITION_EPS
            new_flat = abs(new) < G.POSITION_EPS
            flipped = (not prev_flat and not new_flat and (prev > 0) != (new > 0))
            increasing = abs(new) > abs(prev) + G.POSITION_EPS

            if increasing:
                eq = self.avh.bracket_max(t) if self.avh else None
                if eq is not None and eq > 0:
                    frac = abs(new) * px / eq
                    if frac >= 0.20:
                        self.exp_times.append(t)
                        self.exp_fracs.append(frac)

            cur = cur_by_coin.get(coin)
            if prev_flat and not new_flat:
                cur_by_coin[coin] = {"open_ts": t, "entry_notional": abs(delta) * px,
                                     "pnl": pnl_net}
            elif cur is not None:
                cur["pnl"] += pnl_net
                if increasing:
                    cur["entry_notional"] += abs(delta) * px
                if new_flat or flipped:
                    cur["close_ts"] = t
                    trips_by_coin[coin].append(cur)
                    cur_by_coin[coin] = ({"open_ts": t,
                                          "entry_notional": abs(new) * px,
                                          "pnl": 0.0} if flipped else None)
            # an open position at end of data is not a resolved round trip

        self.days = sorted(day_notional)
        self.day_notional = [day_notional[d] for d in self.days]

        if self.exp_times:
            pairs = sorted(zip(self.exp_times, self.exp_fracs))
            self.exp_times = [p[0] for p in pairs]
            self.exp_fracs = [p[1] for p in pairs]

        # Concatenate in first-appearance coin order, then the same stable sort
        # WalletData applies. That is what keeps equal close_ts in the same
        # relative order, which the post-loss pool is sensitive to.
        trips: list = []
        for coin in coin_first:
            if coin in self.truncated_coins:
                continue
            trips.extend(trips_by_coin.get(coin, ()))
        trips.sort(key=lambda t: t["close_ts"])
        self.trip_close_ts = [t["close_ts"] for t in trips]
        self.trip_open_ts = [t["open_ts"] for t in trips]
        self.trip_notional = [t["entry_notional"] for t in trips]
        self.trip_pnl = [t["pnl"] for t in trips]
        self.by_open = sorted(range(len(trips)), key=lambda i: self.trip_open_ts[i])
        self.open_ts_sorted = [self.trip_open_ts[i] for i in self.by_open]


def build_streaming_wallet(address: str, archetype: str, spill_dir: Path,
                           api_fills: list, complete: bool, portfolio: dict):
    """Assemble one wallet from its spills plus the API tape, twice, lazily."""
    def factory():
        return merged_fills(spill_dir, address, api_fills)
    return StreamingWalletData(address, archetype, factory, complete, portfolio)
