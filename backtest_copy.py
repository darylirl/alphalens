#!/usr/bin/env python3
"""
backtest_copy.py — naive copy-trading backtest against tracked Hyperliquid wallets.

Method
------
1. Cohort: top 10 wallets from the Supabase `wallets` table whose primary
   archetype is directional (scalper / momentum_trader / swing_trader /
   basis_trader), ranked by sharpe_30d (exchange-derived).
   NOTE: `archetype_confidence` is deliberately NULL in our data (we store no
   fabricated confidence), so 30d Sharpe over classified directional wallets is
   the closest honest proxy for "classification confidence". Market makers are
   excluded: their maker flow cannot be mirrored with taker fills.
2. Fills: complete per-wallet history is fetched from the Hyperliquid API by
   forward pagination (the API serves full lifetime history for non-MM wallets;
   verified empirically), cached locally at full fidelity, and mirrored into the
   Supabase `fills` table. History completeness is validated per wallet+coin via
   the first fill's startPosition ≈ 0; truncated coins are excluded and logged.
3. Replay: source positions are reconstructed chronologically per wallet+coin
   (signed running position). Copy rules:
     - source opens from flat  -> open copy position, fixed $1,000 notional
     - source adds             -> no action (fixed sizing, no compounding)
     - source partial-closes   -> close the same FRACTION of the copy position
     - source closes / flips   -> close copy fully (flip also opens a new copy)
4. Frictions on EVERY copy fill (entries and exits):
     - 60s decision delay, executed at the OPEN of the next 1m candle after
       source_fill_time + 60s (candleSnapshot 1m data)
     - 5 bps adverse slippage (buys pay up, sells receive less)
     - 0.045% taker fee per side on filled notional
   If no candle exists within 15 minutes of the target entry minute, the trade
   is skipped ("can't mirror"). Exits walk forward up to 7 days for a candle.
5. Positions still open at end of data are force-closed at the last available
   candle open (counted and flagged separately).

Honesty caveats printed with the results:
  - Cohort selection uses TODAY'S stored 30d Sharpe -> look-ahead bias: early
    months of the replay predate the information used to pick the wallets.
  - Copy sizing is fixed $1k/trade; drawdown % uses an assumed capital base of
    $10,000 (10 wallets x $1k), stated, not derived.

Outputs: backtest_results/{trades,summary_by_wallet,summary_by_archetype,monthly_pnl}.csv
Usage:   python3 backtest_copy.py   (reads SUPABASE_URL / SUPABASE_ANON_KEY from
         env or .env.local in the repo root)
"""

import argparse
import csv
import json
import math
import os
import statistics
import sys
import time
import urllib.request
import urllib.error
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

# ── Config ──────────────────────────────────────────────────────────────────
NOTIONAL_USD = 1_000.0
DELAY_MS = 60_000                      # baseline delay (comparable to run 1)
SENSITIVITY_DELAYS_MS = [60_000, 300_000, 900_000]

# Copyability cohort gates (--cohort copyability)
COPY_ARCHETYPES = ("swing_trader", "momentum_trader")
COPY_MAX_TRADES_30D = 500
COPY_MIN_MEDIAN_HOLD_S = 4 * 3600
COPY_MIN_SPAN_DAYS = 90
COPY_MIN_ROUND_TRIPS = 3               # a median over fewer is degenerate
SLIPPAGE = 0.0005            # 5 bps
TAKER_FEE = 0.00045          # 0.045% per side
CAPITAL_BASE = 10_000.0      # stated assumption for drawdown %
TOP_N = 10
ENTRY_CANDLE_SEARCH_MIN = 15
EXIT_CANDLE_SEARCH_MIN = 7 * 24 * 60
HL_URL = "https://api.hyperliquid.xyz/info"
HL_THROTTLE_S = 0.7
CANDLE_CHUNK_MIN = 3000      # minutes per candleSnapshot request (< 5000 cap)
POSITION_EPS = 1e-9
MINUTE_MS = 60_000

REPO = Path(__file__).resolve().parent
CACHE = REPO / "data" / "backtest_cache"
RESULTS = REPO / "backtest_results"
CACHE.mkdir(parents=True, exist_ok=True)
RESULTS.mkdir(parents=True, exist_ok=True)

# ── Env / HTTP ──────────────────────────────────────────────────────────────

def load_env() -> dict:
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

ENV = load_env()
SUPABASE_URL = ENV.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = ENV.get("SUPABASE_SERVICE_ROLE_KEY") or ENV.get("SUPABASE_ANON_KEY", "")
if not SUPABASE_URL or not SUPABASE_KEY:
    sys.exit("SUPABASE_URL / SUPABASE_ANON_KEY not found in env or .env.local")

UA = "alphalens-backtest/1.0"
_last_hl_call = [0.0]


def http_json(url: str, method: str = "GET", body: dict | list | None = None,
              headers: dict | None = None, retries: int = 4):
    payload = json.dumps(body).encode() if body is not None else None
    hdrs = {"Content-Type": "application/json", "User-Agent": UA}
    if headers:
        hdrs.update(headers)
    delay = 2.0
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=payload, headers=hdrs, method=method)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                text = r.read().decode()
                return json.loads(text) if text else None
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            if attempt == retries:
                raise
            time.sleep(delay)
            delay *= 2
    return None


def hl(body: dict):
    # Global throttle: the info API rate-limits bursts (observed empirically).
    wait = HL_THROTTLE_S - (time.monotonic() - _last_hl_call[0])
    if wait > 0:
        time.sleep(wait)
    _last_hl_call[0] = time.monotonic()
    return http_json(HL_URL, "POST", body)


def sb_get(path_qs: str):
    return http_json(f"{SUPABASE_URL}/rest/v1/{path_qs}",
                     headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"})


def sb_post(path: str, rows: list, extra_headers: dict | None = None):
    hdrs = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
            "Prefer": "return=minimal"}
    if extra_headers:
        hdrs.update(extra_headers)
    return http_json(f"{SUPABASE_URL}/rest/v1/{path}", "POST", rows, headers=hdrs)


# ── Cohort selection ────────────────────────────────────────────────────────

def pick_cohort() -> list[dict]:
    rows = sb_get(
        "wallets?select=address,archetype,tags,win_rate,sharpe_30d,trade_count_30d,avg_hold_seconds"
        "&archetype=in.(scalper,momentum_trader,swing_trader,basis_trader)"
        "&win_rate=not.is.null&sharpe_30d=not.is.null"
        f"&order=sharpe_30d.desc&limit={TOP_N}"
    )
    if not rows:
        sys.exit("No classified directional wallets with measured stats found in Supabase.")
    print(f"Cohort (top {len(rows)} directional wallets by 30d Sharpe — see look-ahead caveat):")
    for w in rows:
        print(f"  {w['address']}  {w['archetype']:<16} sharpe30d={w['sharpe_30d']:>8} "
              f"win_rate={w['win_rate']} trades30d={w['trade_count_30d']}")
    return rows


# ── Fills: fetch complete history, cache, mirror to Supabase ────────────────

def fetch_fills(address: str) -> list[dict]:
    cache_file = CACHE / f"fills_{address.lower()}.json"
    if cache_file.exists():
        return json.loads(cache_file.read_text())

    fills: list[dict] = []
    seen: set[int] = set()
    start = 1
    for _page in range(200):
        page = hl({"type": "userFillsByTime", "user": address, "startTime": start})
        if not isinstance(page, list) or not page:
            break
        new = [f for f in page if f["tid"] not in seen]
        for f in new:
            seen.add(f["tid"])
        fills.extend(new)
        if len(page) < 2000:
            break
        start = max(f["time"] for f in page) + 1
    fills.sort(key=lambda f: f["time"])
    cache_file.write_text(json.dumps(fills))
    return fills


def mirror_to_supabase(address: str, fills: list[dict]) -> None:
    """Persist fills into the (previously empty) fills table. Skips if the
    wallet already has rows there, so reruns don't duplicate."""
    try:
        existing = sb_get(f"fills?select=id&wallet_address=eq.{address.lower()}&limit=1")
        if existing:
            return
        rows = [{
            "wallet_address": address.lower(),
            "asset": f["coin"],
            "side": f["side"],
            "size": float(f["sz"]),
            "price": float(f["px"]),
            "fee_usd": float(f.get("fee") or 0),
            "realized_pnl": float(f.get("closedPnl") or 0),
            "trade_type": f.get("dir") or None,
            "timestamp": datetime.fromtimestamp(f["time"] / 1000, tz=timezone.utc).isoformat(),
        } for f in fills]
        for i in range(0, len(rows), 500):
            sb_post("fills", rows[i:i + 500])
    except Exception as e:  # mirroring is best-effort; the backtest uses the cache
        print(f"  (fills mirror to Supabase failed for {address[:10]}…: {e})")


def pick_cohort_copyability() -> list[dict]:
    """Copyability-first cohort: swing/momentum wallets, trade_count_30d<=500,
    then fill-level qualification — median source hold >= 4h and >= 90 days of
    COMPLETE replayable history (startPosition-validated). Ranked by 30d
    Sharpe; top 10 of the qualifiers."""
    candidates = sb_get(
        "wallets?select=address,archetype,tags,win_rate,sharpe_30d,trade_count_30d,avg_hold_seconds"
        f"&archetype=in.({','.join(COPY_ARCHETYPES)})"
        f"&trade_count_30d=lte.{COPY_MAX_TRADES_30D}"
        "&sharpe_30d=not.is.null"
        "&order=sharpe_30d.desc&limit=200"
    ) or []
    print(f"DB candidates (swing/momentum, <= {COPY_MAX_TRADES_30D} trades/30d, "
          f"Sharpe present): {len(candidates)}")

    qualified: list[dict] = []
    for w in candidates:
        addr = w["address"]
        fills = fetch_fills(addr)
        if not fills:
            print(f"  {addr[:10]}… no fills retrievable — disqualified")
            continue
        trips, truncated, span_days = source_round_trips(fills)
        if len(trips) < COPY_MIN_ROUND_TRIPS:
            print(f"  {addr[:10]}… only {len(trips)} complete round trips — disqualified")
            continue
        med_hold = statistics.median(t["hold_s"] for t in trips)
        if med_hold < COPY_MIN_MEDIAN_HOLD_S:
            print(f"  {addr[:10]}… median hold {med_hold/3600:.1f}h < 4h — disqualified")
            continue
        if span_days < COPY_MIN_SPAN_DAYS:
            print(f"  {addr[:10]}… replayable span {span_days:.0f}d < {COPY_MIN_SPAN_DAYS}d — disqualified")
            continue
        w["_median_hold_s"] = med_hold
        w["_span_days"] = span_days
        w["_round_trips"] = len(trips)
        w["_truncated_coins"] = len(truncated)
        qualified.append(w)
        print(f"  {addr[:10]}… QUALIFIED: median hold {med_hold/3600:.1f}h, "
              f"span {span_days:.0f}d, {len(trips)} trips, sharpe30d={w['sharpe_30d']}")

    print(f"\nQUALIFIED BEFORE TOP-10 CUT: {len(qualified)} wallet(s)")
    cohort = qualified[:TOP_N]  # candidates were already Sharpe-ordered
    print(f"Cohort: {len(cohort)} wallet(s)")
    for w in cohort:
        print(f"  {w['address']}  {w['archetype']:<16} sharpe30d={w['sharpe_30d']:>8} "
              f"medHold={w['_median_hold_s']/3600:.1f}h span={w['_span_days']:.0f}d "
              f"trips={w['_round_trips']}")
    return cohort


# ── Candles ─────────────────────────────────────────────────────────────────
# Hyperliquid retains only ~5000 bars PER INTERVAL (measured live: 1m→3.5d,
# 5m→17.4d, 15m→52.1d, 1h→208.4d, 4h→833d). The spec's "next 1m candle open"
# is therefore physically impossible for history older than ~3.5 days: fills
# use the FINEST interval whose retention covers the timestamp, and every
# trade records the granularity it was filled at.
CANDLE_INTERVALS = [  # (name, bar_ms) finest → coarsest
    ("1m", 60_000),
    ("5m", 300_000),
    ("15m", 900_000),
    ("1h", 3_600_000),
    ("4h", 14_400_000),
    ("1d", 86_400_000),
]
RETENTION_BARS = 4_900          # conservative vs the ~5000 measured
CHUNK_BARS = 4_000              # bars per candleSnapshot request (< 5000 cap)
RUN_NOW_MS = int(time.time() * 1000)


def interval_for(ts: int):
    """Finest interval whose retention window still covers ts."""
    for name, ms in CANDLE_INTERVALS:
        if ts >= RUN_NOW_MS - RETENTION_BARS * ms:
            return name, ms
    return CANDLE_INTERVALS[-1]


class CandleStore:
    """Candle opens per (coin, interval), fetched in chunks, cached on disk."""

    def __init__(self):
        self.opens: dict[tuple, dict[int, float]] = defaultdict(dict)
        self.fetched: dict[tuple, set[int]] = defaultdict(set)
        self.dead: dict[tuple, set[int]] = defaultdict(set)

    def _ensure_chunk(self, coin: str, iname: str, ims: int, chunk_start: int):
        key = (coin, iname)
        if chunk_start in self.fetched[key] or chunk_start in self.dead[key]:
            return
        safe_coin = coin.replace(":", "_").replace("/", "_")
        cache_file = CACHE / f"candles2_{safe_coin}_{iname}_{chunk_start}.json"
        if cache_file.exists():
            data = json.loads(cache_file.read_text())
        else:
            end = chunk_start + CHUNK_BARS * ims
            data = hl({"type": "candleSnapshot",
                       "req": {"coin": coin, "interval": iname,
                               "startTime": chunk_start, "endTime": end}})
            if not isinstance(data, list):
                data = []
            cache_file.write_text(json.dumps(
                [{"t": c["t"], "o": c["o"]} for c in data]))
            data = json.loads(cache_file.read_text())
        if not data:
            self.dead[key].add(chunk_start)
            return
        for c in data:
            self.opens[key][int(c["t"])] = float(c["o"])
        self.fetched[key].add(chunk_start)

    def open_at_or_after(self, coin: str, target: int, max_search_ms: int):
        """(bar_ts, open, interval_name) of the first bar at or after target on
        the finest retained interval, searching forward at least 3 bars and up
        to max_search_ms. None if no bar found."""
        iname, ims = interval_for(target)
        key = (coin, iname)
        chunk_ms = CHUNK_BARS * ims
        t = ((target + ims - 1) // ims) * ims          # next bar boundary
        end = target + max(max_search_ms, 3 * ims)
        while t < end:
            self._ensure_chunk(coin, iname, ims, (t // chunk_ms) * chunk_ms)
            opens = self.opens[key]
            chunk_end = (t // chunk_ms) * chunk_ms + chunk_ms
            while t < min(end, chunk_end):
                if t in opens:
                    return t, opens[t], iname
                t += ims
        return None


def copy_fill_price(candles: CandleStore, coin: str, source_time: int,
                    is_buy: bool, max_minutes: int, delay_ms: int = DELAY_MS):
    """Price for a copy fill: open of the next retained candle after
    source_time+delay, with 5 bps adverse slippage.
    Returns (fill_ts, price, granularity) or None."""
    decision = source_time + delay_ms
    hit = candles.open_at_or_after(coin, decision, max_minutes * MINUTE_MS)
    if hit is None:
        return None
    ts, px, gran = hit
    px = px * (1 + SLIPPAGE) if is_buy else px * (1 - SLIPPAGE)
    return ts, px, gran


# ── Replay ──────────────────────────────────────────────────────────────────

def source_round_trips(fills: list[dict]):
    """Reconstruct the SOURCE wallet's closed round trips (no frictions).
    Returns (trips, truncated_coins, replayable_span_days) where trips are
    dicts {coin, open_ts, close_ts, hold_s} over non-truncated coins only."""
    by_coin: dict[str, list[dict]] = defaultdict(list)
    for f in fills:
        by_coin[f["coin"]].append(f)

    trips: list[dict] = []
    truncated: list[str] = []
    span_min, span_max = None, None

    for coin, cfills in by_coin.items():
        cfills.sort(key=lambda f: f["time"])
        if abs(float(cfills[0].get("startPosition") or 0)) > POSITION_EPS:
            truncated.append(coin)
            continue
        span_min = cfills[0]["time"] if span_min is None else min(span_min, cfills[0]["time"])
        span_max = cfills[-1]["time"] if span_max is None else max(span_max, cfills[-1]["time"])

        pos = 0.0
        open_ts = None
        for f in cfills:
            delta = float(f["sz"]) * (1 if f["side"] == "B" else -1)
            reported = f.get("startPosition")
            prev = float(reported) if reported is not None else pos
            new = prev + delta
            pos = 0.0 if abs(new) < POSITION_EPS else new
            prev_flat = abs(prev) < POSITION_EPS
            new_flat = abs(new) < POSITION_EPS
            flipped = not prev_flat and not new_flat and (prev > 0) != (new > 0)
            if prev_flat and not new_flat:
                open_ts = f["time"]
            elif (new_flat or flipped) and open_ts is not None:
                trips.append({"coin": coin, "open_ts": open_ts, "close_ts": f["time"],
                              "hold_s": (f["time"] - open_ts) / 1000})
                open_ts = f["time"] if flipped else None

    span_days = ((span_max - span_min) / 86_400_000) if span_min is not None else 0.0
    return trips, truncated, span_days


def replay_wallet(address: str, archetype: str, fills: list[dict],
                  candles: CandleStore, log: list[str],
                  delay_ms: int = DELAY_MS) -> list[dict]:
    trades: list[dict] = []
    by_coin: dict[str, list[dict]] = defaultdict(list)
    for f in fills:
        by_coin[f["coin"]].append(f)

    for coin, cfills in by_coin.items():
        cfills.sort(key=lambda f: f["time"])
        first_sp = float(cfills[0].get("startPosition") or 0)
        if abs(first_sp) > POSITION_EPS:
            log.append(f"{address[:10]}… {coin}: history truncated "
                       f"(first startPosition={first_sp}); coin skipped")
            continue

        src_pos = 0.0
        copy = None  # {qty, entry_px, entry_ts, dir, fees, source_open_ts}

        def close_fraction(frac: float, source_time: int, exit_reason: str):
            nonlocal copy
            if copy is None or frac <= 0:
                return
            frac = min(frac, 1.0)
            qty = copy["qty"] * frac
            exit_is_buy = copy["dir"] == "short"
            hit = copy_fill_price(candles, coin, source_time, exit_is_buy,
                                  EXIT_CANDLE_SEARCH_MIN, delay_ms)
            if hit is None:
                log.append(f"{address[:10]}… {coin}: no exit candle within 7d "
                           f"of {source_time}; position abandoned unpriced")
                copy = None
                return
            exit_ts, exit_px, exit_gran = hit
            sign = 1 if copy["dir"] == "long" else -1
            gross = qty * (exit_px - copy["entry_px"]) * sign
            fee = qty * exit_px * TAKER_FEE
            entry_fee_part = copy["entry_fee"] * frac
            trades.append({
                "wallet": address.lower(), "archetype": archetype, "coin": coin,
                "dir": copy["dir"], "qty": qty,
                "entry_ts": copy["entry_ts"], "entry_px": copy["entry_px"],
                "exit_ts": exit_ts, "exit_px": exit_px,
                "gross_pnl": gross, "fees": entry_fee_part + fee,
                "net_pnl": gross - entry_fee_part - fee,
                "hold_s": (exit_ts - copy["entry_ts"]) / 1000,
                "exit_reason": exit_reason,
                "entry_gran": copy["entry_gran"], "exit_gran": exit_gran,
            })
            copy["qty"] -= qty
            if copy["qty"] * copy["entry_px"] < 0.01 or frac >= 1.0:
                copy = None

        def open_copy(direction: str, source_time: int):
            nonlocal copy
            entry_is_buy = direction == "long"
            hit = copy_fill_price(candles, coin, source_time, entry_is_buy,
                                  ENTRY_CANDLE_SEARCH_MIN, delay_ms)
            if hit is None:
                log.append(f"{address[:10]}… {coin}: no entry candle within "
                           f"{ENTRY_CANDLE_SEARCH_MIN}m of {source_time}; trade skipped")
                copy = None
                return
            entry_ts, entry_px, entry_gran = hit
            qty = NOTIONAL_USD / entry_px
            copy = {"qty": qty, "entry_px": entry_px, "entry_ts": entry_ts,
                    "dir": direction, "entry_fee": qty * entry_px * TAKER_FEE,
                    "entry_gran": entry_gran}

        for f in cfills:
            sz = float(f["sz"])
            delta = sz if f["side"] == "B" else -sz
            reported = f.get("startPosition")
            prev = float(reported) if reported is not None else src_pos
            new = prev + delta
            src_pos = 0.0 if abs(new) < POSITION_EPS else new

            prev_flat = abs(prev) < POSITION_EPS
            new_flat = abs(new) < POSITION_EPS
            flipped = not prev_flat and not new_flat and (prev > 0) != (new > 0)

            if prev_flat and not new_flat:
                open_copy("long" if new > 0 else "short", f["time"])
            elif flipped:
                close_fraction(1.0, f["time"], "source_flip")
                open_copy("long" if new > 0 else "short", f["time"])
            elif not prev_flat and new_flat:
                close_fraction(1.0, f["time"], "source_close")
            elif not prev_flat and abs(new) < abs(prev):
                close_fraction((abs(prev) - abs(new)) / abs(prev), f["time"],
                               "source_partial_close")
            # adds (same sign, larger) -> no action, fixed sizing

        if copy is not None:
            # Source still holds at end of data: force-close at last candle.
            last_time = cfills[-1]["time"]
            close_fraction(1.0, last_time, "end_of_data")

    return trades


# ── Metrics & report ────────────────────────────────────────────────────────

def summarize(trades: list[dict]) -> dict:
    if not trades:
        return {"trades": 0, "net_pnl": 0.0, "win_rate": None, "profit_factor": None,
                "max_dd_usd": 0.0, "max_dd_pct": 0.0, "avg_hold_s": None}
    closed = sorted(trades, key=lambda t: t["exit_ts"])
    net = sum(t["net_pnl"] for t in closed)
    wins = [t for t in closed if t["net_pnl"] > 0]
    losses = [t for t in closed if t["net_pnl"] <= 0]
    gross_win = sum(t["net_pnl"] for t in wins)
    gross_loss = -sum(t["net_pnl"] for t in losses)
    equity = peak = 0.0
    max_dd = 0.0
    for t in closed:
        equity += t["net_pnl"]
        peak = max(peak, equity)
        max_dd = max(max_dd, peak - equity)
    return {
        "trades": len(closed),
        "net_pnl": net,
        "win_rate": len(wins) / len(closed),
        "profit_factor": (gross_win / gross_loss) if gross_loss > 0 else math.inf,
        "max_dd_usd": max_dd,
        "max_dd_pct": max_dd / CAPITAL_BASE * 100,
        "avg_hold_s": sum(t["hold_s"] for t in closed) / len(closed),
    }


def fmt_hold(seconds) -> str:
    if seconds is None:
        return "—"
    if seconds < 3600:
        return f"{seconds/60:.1f}m"
    if seconds < 86400:
        return f"{seconds/3600:.1f}h"
    return f"{seconds/86400:.1f}d"


def write_csvs(trades: list[dict], by_wallet: dict, by_arch: dict, monthly: dict,
               prefix: str = ""):
    with open(RESULTS / f"{prefix}trades.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(trades[0].keys()) if trades else
                           ["wallet", "archetype", "coin"])
        w.writeheader()
        for t in trades:
            w.writerow(t)

    def dump_summary(path: Path, keyed: dict, key_name: str):
        with open(path, "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow([key_name, "trades", "net_pnl_usd", "win_rate",
                        "profit_factor", "max_dd_usd", "max_dd_pct", "avg_hold"])
            for k, s in keyed.items():
                pf = s["profit_factor"]
                w.writerow([k, s["trades"], f"{s['net_pnl']:.2f}",
                            f"{s['win_rate']:.3f}" if s["win_rate"] is not None else "",
                            f"{pf:.3f}" if pf not in (None, math.inf) else ("inf" if pf == math.inf else ""),
                            f"{s['max_dd_usd']:.2f}", f"{s['max_dd_pct']:.2f}",
                            fmt_hold(s["avg_hold_s"])])

    dump_summary(RESULTS / f"{prefix}summary_by_wallet.csv", by_wallet, "wallet")
    dump_summary(RESULTS / f"{prefix}summary_by_archetype.csv", by_arch, "archetype")

    with open(RESULTS / f"{prefix}monthly_pnl.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["month", "trades", "net_pnl_usd"])
        for month in sorted(monthly):
            w.writerow([month, monthly[month]["trades"], f"{monthly[month]['pnl']:.2f}"])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cohort", choices=["sharpe", "copyability"],
                        default="sharpe",
                        help="sharpe = run-1 cohort rule; copyability = "
                             "swing/momentum, hold/history gated")
    args = parser.parse_args()
    prefix = "v2_" if args.cohort == "copyability" else ""

    t0 = time.time()
    print("=" * 72)
    print(f"COPY-TRADING BACKTEST — naive, honest, unoptimized [{args.cohort}]")
    print("=" * 72)

    cohort = pick_cohort_copyability() if args.cohort == "copyability" else pick_cohort()
    candles = CandleStore()
    log: list[str] = []
    all_trades: list[dict] = []
    sensitivity: dict[int, dict] = {}

    for w in cohort:
        addr = w["address"]
        print(f"\n{addr} [{w['archetype']}]")
        fills = fetch_fills(addr)
        if not fills:
            print("  no fills retrievable — wallet skipped")
            continue
        span_d = (fills[-1]["time"] - fills[0]["time"]) / 86_400_000
        print(f"  fills: {len(fills)} spanning {span_d:.1f} days "
              f"({datetime.fromtimestamp(fills[0]['time']/1000, tz=timezone.utc):%Y-%m-%d} → "
              f"{datetime.fromtimestamp(fills[-1]['time']/1000, tz=timezone.utc):%Y-%m-%d})")
        mirror_to_supabase(addr, fills)
        trades = replay_wallet(addr, w["archetype"], fills, candles, log)
        s = summarize(trades)
        print(f"  copied trades: {s['trades']}, net PnL ${s['net_pnl']:.2f}")
        all_trades.extend(trades)

    # Delay sensitivity (copyability mode): identical replay at 60/300/900s.
    if args.cohort == "copyability" and all_trades:
        for delay in SENSITIVITY_DELAYS_MS:
            if delay == DELAY_MS:
                sensitivity[delay] = summarize(all_trades)
                continue
            delay_trades: list[dict] = []
            dlog: list[str] = []
            for w in cohort:
                fills = fetch_fills(w["address"])
                if fills:
                    delay_trades.extend(
                        replay_wallet(w["address"], w["archetype"], fills,
                                      candles, dlog, delay_ms=delay))
            sensitivity[delay] = summarize(delay_trades)

    if not all_trades:
        sys.exit("\nNo trades could be copied — nothing to report.")

    # Breakdowns
    by_wallet_trades = defaultdict(list)
    by_arch_trades = defaultdict(list)
    monthly = defaultdict(lambda: {"trades": 0, "pnl": 0.0})
    for t in all_trades:
        by_wallet_trades[t["wallet"]].append(t)
        by_arch_trades[t["archetype"]].append(t)
        month = datetime.fromtimestamp(t["exit_ts"] / 1000, tz=timezone.utc).strftime("%Y-%m")
        monthly[month]["trades"] += 1
        monthly[month]["pnl"] += t["net_pnl"]

    overall = summarize(all_trades)
    by_wallet = {k: summarize(v) for k, v in by_wallet_trades.items()}
    by_arch = {k: summarize(v) for k, v in by_arch_trades.items()}
    write_csvs(all_trades, by_wallet, by_arch, monthly, prefix)

    if sensitivity:
        with open(RESULTS / f"{prefix}delay_sensitivity.csv", "w", newline="") as fh:
            cw = csv.writer(fh)
            cw.writerow(["delay_s", "trades", "net_pnl_usd", "win_rate", "profit_factor"])
            for delay in SENSITIVITY_DELAYS_MS:
                s = sensitivity[delay]
                pf = s["profit_factor"]
                cw.writerow([delay // 1000, s["trades"], f"{s['net_pnl']:.2f}",
                             f"{s['win_rate']:.3f}" if s["win_rate"] is not None else "",
                             f"{pf:.3f}" if pf not in (None, math.inf) else "inf"])

    forced = sum(1 for t in all_trades if t["exit_reason"] == "end_of_data")

    print("\n" + "=" * 72)
    print("OVERALL")
    print("=" * 72)
    pf = overall["profit_factor"]
    print(f"  trades:         {overall['trades']}  ({forced} force-closed at end of data)")
    print(f"  net PnL:        ${overall['net_pnl']:.2f}")
    print(f"  win rate:       {overall['win_rate']*100:.1f}%")
    print(f"  profit factor:  {'inf' if pf == math.inf else f'{pf:.3f}'}")
    print(f"  max drawdown:   ${overall['max_dd_usd']:.2f}  "
          f"({overall['max_dd_pct']:.2f}% of ${CAPITAL_BASE:.0f} assumed capital)")
    print(f"  avg hold:       {fmt_hold(overall['avg_hold_s'])}")

    print("\nBY ARCHETYPE")
    for k, s in sorted(by_arch.items(), key=lambda kv: -kv[1]["net_pnl"]):
        pf_s = "inf" if s["profit_factor"] == math.inf else "{:.2f}".format(s["profit_factor"])
        print(f"  {k:<16} trades={s['trades']:<5} net=${s['net_pnl']:>10.2f}  "
              f"wr={s['win_rate']*100:5.1f}%  pf={pf_s}  hold={fmt_hold(s['avg_hold_s'])}")

    print("\nBY WALLET")
    for k, s in sorted(by_wallet.items(), key=lambda kv: -kv[1]["net_pnl"]):
        print(f"  {k[:12]}…  trades={s['trades']:<5} net=${s['net_pnl']:>10.2f}  "
              f"wr={s['win_rate']*100:5.1f}%  dd=${s['max_dd_usd']:.2f}")

    print("\nMONTHLY PnL (edge decay check)")
    for month in sorted(monthly):
        m = monthly[month]
        bar = "█" * min(40, int(abs(m["pnl"]) / 25)) if m["pnl"] else ""
        sign = "+" if m["pnl"] >= 0 else "-"
        print(f"  {month}  {m['trades']:>5} trades  {sign}${abs(m['pnl']):>9.2f}  {bar}")

    gran_mix = defaultdict(int)
    for t in all_trades:
        gran_mix[t.get("entry_gran", "?")] += 1
    print("\nFILL GRANULARITY MIX (candle retention forces coarser bars on older history)")
    for g, n in sorted(gran_mix.items(), key=lambda kv: -kv[1]):
        print(f"  {g:>3}: {n} trades ({n/len(all_trades)*100:.0f}%)")

    if sensitivity:
        print("\nDELAY SENSITIVITY (same cohort, same frictions, only delay varies)")
        for delay in SENSITIVITY_DELAYS_MS:
            s = sensitivity[delay]
            pf = s["profit_factor"]
            pf_s = "inf" if pf == math.inf else ("—" if pf is None else f"{pf:.3f}")
            wr_s = "—" if s["win_rate"] is None else f"{s['win_rate']*100:.1f}%"
            print(f"  {delay//1000:>4}s delay:  net ${s['net_pnl']:>10.2f}  "
                  f"trades={s['trades']}  wr={wr_s}  pf={pf_s}")
        print("  NOTE: on bars coarser than 1m, delays shorter than the bar mostly")
        print("  land on the SAME next bar open — differences are diluted by the")
        print("  granularity mix above, so read this as a lower bound on delay cost.")

    if log:
        print(f"\nSKIPPED / WARNINGS ({len(log)}):")
        for line in log[:20]:
            print(f"  {line}")
        if len(log) > 20:
            print(f"  … and {len(log) - 20} more (see logs)")

    print("\nCAVEATS (read before believing any of this):")
    print("  1. Cohort picked by TODAY'S 30d Sharpe — look-ahead bias: early months")
    print("     predate the information used to select these wallets.")
    print("  2. Drawdown % assumes a $10,000 capital base (10 wallets × $1k).")
    print("  3. Fill model is 1m-candle opens + 5bps — real slippage on thin coins")
    print("     will be worse; candle opens can't model intra-minute adverse moves.")
    print("  4. Source adds are not copied (fixed sizing); proportional partial")
    print("     closes are mirrored against the source's true position size.")
    print(f"\nCSVs written to {RESULTS}/. Runtime {time.time()-t0:.0f}s.")


if __name__ == "__main__":
    main()
