#!/usr/bin/env python3
"""
backtest_graduation.py — MERIT P0 graduated-book test.

Implements docs/merit_p0_backtest_spec.md (v1.0, 2026-08-25) exactly. The
spec's G0 thresholds, walk-forward protocol, book construction, kill criteria
and data-constraint rules are binding; nothing here is optimized.

What this is NOT: a copy-trading replay. Per spec §1 the book simulates being
the capital behind the wallets, so book returns are the wallets' own realized
returns scaled to allocation. No mirror trades are simulated, so the execution
friction floors (60s delay / 5bps slippage / taker fee) that bind every trade
REPLAY have no execution to attach to here; wallet returns are net of the fees
the wallets themselves actually paid. The frictions that bind this test are
selection honesty, look-ahead prevention, survivorship inclusion, and the
capacity haircut (spec §1, §4).

Data sources (all disclosed per wallet in the outputs):
  - Universe: Supabase `wallets`, classified directional archetypes
    (scalper, momentum_trader, swing_trader, basis_trader). Market makers are
    excluded: their fill history is not fully retrievable and maker flow is
    not the underwriting target. Every PostgREST read is paginated.
  - Scope: the PERP account. Spot pairs are excluded by construction: spot
    balances also move by transfers, so a fills-based completeness validation
    is structurally impossible for them, and perp trading is what MERIT
    underwrites. Disclosed in the report.
  - Fills: complete lifetime per wallet from the Hyperliquid API
    (userFillsByTime forward pagination), cached locally — the same fills
    store as backtest_copy.py. Completeness is validated per wallet+coin via
    the first fill's startPosition ≈ 0; truncated coins exclude the wallet at
    any decision date where they trade (excluded and logged, never guessed).
    Fills are NOT mirrored to Supabase: the capture capacity budget
    (wallets.capture_enabled) is not widened by a research run.
  - Equity / returns: Hyperliquid `portfolio` perpAllTime accountValueHistory
    + pnlHistory where servable (sampled ~11 days by the API; linear
    interpolation at month boundaries, disclosed), extended into the
    pre-2024-05 spot-free era by allTime samples; else reconstructed from
    fills (realized closedPnl − fees; excludes funding payments and
    unrealized excursions, disclosed).
  - Benchmark: HLP vault public performance history (vaultDetails), cached
    locally, identical calendar windows, identical accounting (Δcum-pnl over
    period ÷ equity at period start, gross of fund fees on both sides).
  - Market factor: BTC via the candleSnapshot ladder from backtest_copy.py
    (reported alpha/beta only, not gating).

Honesty mechanics carried over from the repo invariants:
  - Missing data is never zero: an unmeasurable wallet-period is excluded and
    reported, never coalesced to a 0 return; coverage is tracked separately
    from values and the served walk-forward window is the longest
    verified-contiguous run of decision dates, with drops reported.
  - Penny reconciliation: every book period return must equal the sum of its
    per-wallet contributions to <1e-9, or the run aborts.
  - The 18-month gate: if the honest window is under 18 months the run stops
    after the coverage report and requires --confirm-low-power (the operator's
    explicit confirmation); the verdict then carries the LOW-POWER flag.

Usage:
  python3 backtest_graduation.py                 # fetch, coverage report, gate, full run
  python3 backtest_graduation.py --coverage-only # stop after the coverage report
  python3 backtest_graduation.py --confirm-low-power  # proceed under 18 months
  (reads SUPABASE_URL / SUPABASE_ANON_KEY from env or .env.local)

Outputs: backtest_results/graduation/ (coverage, per-period book CSVs,
equity curves, contributions, robustness battery, exclusions, actuarial seed,
verdict.txt) and the verdict block on stdout.
"""

import argparse
import bisect
import csv
import json
import math
import os
import statistics
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

# ── Pre-registered configuration (spec §2; the headline numbers are binding) ─
G0_DEFAULT = {
    "min_round_trips": 60,      # eligibility floor: resolved round trips in window
    "min_active_days": 30,      # eligibility floor: distinct active days in window
    "max_dd_frac": 0.15,        # 1. drawdown discipline vs window-start equity
    "max_size_cv": 1.5,         # 2. sizing consistency (CV of per-trade notional, opens only)
    "max_postloss_ratio": 1.3,  # 3. revenge-sizing gate (median of 3 post-loss trades / window median)
    "max_exposure_frac": 0.40,  # 4. exposure discipline (single position vs equity at entry)
    "max_liquidations": 0,      # 5. kill-style survivorship (not perturbable: zero is zero)
}
PERTURB_KEYS = ["min_round_trips", "min_active_days", "max_dd_frac",
                "max_size_cv", "max_postloss_ratio", "max_exposure_frac"]
PERTURB_FRAC = 0.20             # ±20 percent, one at a time (spec §6.4c)

EVAL_WINDOW_DAYS = 60           # trailing eval window at each decision date
FORWARD_FUNDED_DAYS = 90        # graduation funds forward 90d; monthly recertification
                                # (spec §3) removes at the next T on any G0 failure, so
                                # book membership at each monthly period is the set
                                # passing G0 at that period's decision date.
PER_WALLET_CAP = 0.05           # 5% book cap, cash earns zero (spec §4)
CAPACITY_MEDIAN_DAILY_NOTIONAL = 5_000_000.0
CAPACITY_HAIRCUT = 0.25         # 25% haircut on contributions above the line (spec §4)
MIN_BOOK_BREADTH = 15.0         # kill criterion 3
MIN_WINDOW_MONTHS = 18          # LOW-POWER gate (spec §7)
EQUITY_ANCHOR_FLOOR = 1_000.0   # below this the return denominator is unreliable:
                                # wallet-period excluded and logged, never guessed
ANNUALIZE = math.sqrt(12.0)

HLP_VAULT = "0xdfc24b077bc1425ad1dea75bcb6f8158e10df303"
DIRECTIONAL = ("scalper", "momentum_trader", "swing_trader", "basis_trader")

HL_URL = "https://api.hyperliquid.xyz/info"
HL_THROTTLE_S = 0.7
FILLS_PAGE_CAP = 600            # 600 × 2000 fills; hitting the cap = incomplete → excluded
POSITION_EPS = 1e-9
DAY_MS = 86_400_000

REPO = Path(__file__).resolve().parent
CACHE = REPO / "data" / "backtest_cache"
RESULTS = REPO / "backtest_results" / "graduation"
CACHE.mkdir(parents=True, exist_ok=True)
RESULTS.mkdir(parents=True, exist_ok=True)

# ── Env / HTTP (same conventions as backtest_copy.py) ───────────────────────

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

UA = "alphalens-backtest-graduation/1.0"
_last_hl_call = [0.0]


def http_json(url: str, method: str = "GET", body=None, headers=None, retries: int = 4):
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
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError,
                json.JSONDecodeError):
            if attempt == retries:
                raise
            time.sleep(delay)
            delay *= 2
    return None


def hl(body: dict):
    wait = HL_THROTTLE_S - (time.monotonic() - _last_hl_call[0])
    if wait > 0:
        time.sleep(wait)
    _last_hl_call[0] = time.monotonic()
    return http_json(HL_URL, "POST", body)


def sb_page_all(path: str, qs: str, order: str, page_size: int = 1000) -> list:
    """Paginated PostgREST read: PostgREST silently truncates near 1000 rows,
    so every read pages until a short page comes back (repo invariant)."""
    rows: list = []
    offset = 0
    while True:
        page = http_json(
            f"{SUPABASE_URL}/rest/v1/{path}?{qs}&order={order}"
            f"&limit={page_size}&offset={offset}",
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"})
        if not isinstance(page, list):
            break
        rows.extend(page)
        if len(page) < page_size:
            break
        offset += page_size
    return rows


# ── Universe ────────────────────────────────────────────────────────────────

def fetch_universe() -> list[dict]:
    rows = sb_page_all(
        "wallets",
        "select=address,archetype"
        f"&archetype=in.({','.join(DIRECTIONAL)})",
        "address.asc")
    if not rows:
        sys.exit("No classified directional wallets found in Supabase.")
    return rows


# ── Fills store (reused shape from backtest_copy.py, plus completeness flag) ─

def fetch_fills(address: str) -> tuple[list[dict], bool]:
    """Complete lifetime fills via forward pagination, cached locally.
    Returns (fills, complete). complete=False means the page cap was hit and
    the history cannot be trusted as complete — the wallet is excluded."""
    cache_file = CACHE / f"gfills_{address.lower()}.json"
    if cache_file.exists():
        blob = json.loads(cache_file.read_text())
        return blob["fills"], blob["complete"]

    fills: list[dict] = []
    seen: set[int] = set()
    start = 1
    complete = False
    for _page in range(FILLS_PAGE_CAP):
        page = hl({"type": "userFillsByTime", "user": address, "startTime": start})
        if not isinstance(page, list) or not page:
            complete = True
            break
        new = [f for f in page if f["tid"] not in seen]
        for f in new:
            seen.add(f["tid"])
        fills.extend(new)
        if len(page) < 2000:
            complete = True
            break
        start = max(f["time"] for f in page) + 1
    fills.sort(key=lambda f: f["time"])

    def own_liquidation(f: dict) -> bool:
        """True only when THIS wallet was liquidated. The liquidation field
        also appears on counterparty fills (taking over someone else's
        liquidated position, liquidatedUser = someone else) — those are not
        survivorship events for this wallet. A missing liquidatedUser is the
        older API format, observed only on own-liquidation closes."""
        liq = f.get("liquidation")
        if liq:
            lu = (liq.get("liquidatedUser") or "").lower()
            return lu in ("", address.lower())
        return "liquidat" in (f.get("dir") or "").lower()

    slim = [{"coin": f["coin"], "side": f["side"], "time": f["time"],
             "sz": f["sz"], "px": f["px"], "fee": f.get("fee"),
             "feeToken": f.get("feeToken"), "closedPnl": f.get("closedPnl"),
             "startPosition": f.get("startPosition"), "dir": f.get("dir"),
             "liq": own_liquidation(f)}
            for f in fills]
    cache_file.write_text(json.dumps({"complete": complete, "fills": slim}))
    return slim, complete


def fetch_portfolio(address: str) -> dict:
    """Hyperliquid portfolio histories (allTime + perpAllTime), cached locally.
    The test's scope is the perp account, so perpAllTime is primary; the API
    only splits perp from spot accounting at 2024-05-01, so the spot-free era
    before perpAllTime's first sample is served by allTime (spliced by the
    SampledSeries constructors below, disclosed in the report)."""
    cache_file = CACHE / f"gportfolio2_{address.lower()}.json"
    if cache_file.exists():
        return json.loads(cache_file.read_text())
    blob = {"fetched_at": int(time.time() * 1000)}
    try:
        data = hl({"type": "portfolio", "user": address})
        d = dict(data) if data else {}
        for key in ("allTime", "perpAllTime"):
            seg = d.get(key) or {}
            blob[key] = {
                "avh": [[int(t), float(v)] for t, v in (seg.get("accountValueHistory") or [])],
                "pnl": [[int(t), float(v)] for t, v in (seg.get("pnlHistory") or [])]}
    except Exception:
        blob["allTime"] = blob["perpAllTime"] = {"avh": [], "pnl": []}
    cache_file.write_text(json.dumps(blob))
    return blob


def splice_perp_series(portfolio: dict, field: str, align: bool) -> list:
    """perpAllTime samples, extended backwards with allTime samples from the
    pre-split (spot-free) era. Equity levels (align=False) are used raw — an
    equity is an equity; cumulative pnl (align=True) is offset-shifted so the
    two segments are continuous at the splice and period differences never
    jump across it."""
    post = (portfolio.get("perpAllTime") or {}).get(field) or []
    pre = (portfolio.get("allTime") or {}).get(field) or []
    if not post:
        return pre
    t0 = int(post[0][0])
    pre_cut = [[int(t), float(v)] for t, v in pre if int(t) < t0]
    if not pre_cut:
        return post
    if align:
        offset = float(post[0][1]) - float(pre_cut[-1][1])
        pre_cut = [[t, v + offset] for t, v in pre_cut]
    return pre_cut + [[int(t), float(v)] for t, v in post]


def is_spot(coin: str) -> bool:
    """Spot pairs ('@123', 'PURR/USDC') are out of scope: spot balances move
    by transfers as well as fills, so a fills-based completeness validation is
    structurally impossible for them — the perp account is the test's scope."""
    return coin.startswith("@") or "/" in coin


def fetch_hlp_series() -> dict:
    """HLP vault public performance history (allTime), cached locally."""
    cache_file = CACHE / "ghlp_vault.json"
    if cache_file.exists():
        return json.loads(cache_file.read_text())
    data = hl({"type": "vaultDetails", "vaultAddress": HLP_VAULT})
    port = dict(data.get("portfolio") or [])
    at = port.get("allTime") or {}
    blob = {"fetched_at": int(time.time() * 1000),
            "avh": [[int(t), float(v)] for t, v in (at.get("accountValueHistory") or [])],
            "pnl": [[int(t), float(v)] for t, v in (at.get("pnlHistory") or [])]}
    if not blob["avh"] or not blob["pnl"]:
        sys.exit("HLP vault history not servable — benchmark unavailable, aborting.")
    cache_file.write_text(json.dumps(blob))
    return blob


# ── Candle ladder (reused from backtest_copy.py) — BTC factor only ──────────
CANDLE_INTERVALS = [("1m", 60_000), ("5m", 300_000), ("15m", 900_000),
                    ("1h", 3_600_000), ("4h", 14_400_000), ("1d", 86_400_000)]
RETENTION_BARS = 4_900
CHUNK_BARS = 4_000
RUN_NOW_MS = int(time.time() * 1000)


def interval_for(ts: int):
    for name, ms in CANDLE_INTERVALS:
        if ts >= RUN_NOW_MS - RETENTION_BARS * ms:
            return name, ms
    return CANDLE_INTERVALS[-1]


class CandleStore:
    def __init__(self):
        self.opens: dict[tuple, dict[int, float]] = defaultdict(dict)
        self.fetched: dict[tuple, set[int]] = defaultdict(set)
        self.dead: dict[tuple, set[int]] = defaultdict(set)

    def _ensure_chunk(self, coin, iname, ims, chunk_start):
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
            cache_file.write_text(json.dumps([{"t": c["t"], "o": c["o"]} for c in data]))
            data = json.loads(cache_file.read_text())
        if not data:
            self.dead[key].add(chunk_start)
            return
        for c in data:
            self.opens[key][int(c["t"])] = float(c["o"])
        self.fetched[key].add(chunk_start)

    def open_at_or_after(self, coin, target, max_search_ms):
        iname, ims = interval_for(target)
        key = (coin, iname)
        chunk_ms = CHUNK_BARS * ims
        t = ((target + ims - 1) // ims) * ims
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


# ── Series interpolation (portfolio avh / pnl are ~11-day samples) ──────────

class SampledSeries:
    """Linear interpolation over the API's sampled (ts, value) history.
    value_at returns None outside the sampled span (missing is never guessed);
    anchor_at clamps to the first sample only when the account began inside
    the requested window (the account genuinely did not exist before it)."""

    def __init__(self, pairs: list):
        pairs = sorted((int(t), float(v)) for t, v in pairs)
        self.ts = [p[0] for p in pairs]
        self.vs = [p[1] for p in pairs]

    def __bool__(self):
        return len(self.ts) >= 2

    def value_at(self, t: int):
        if not self.ts or t < self.ts[0] or t > self.ts[-1]:
            return None
        i = bisect.bisect_right(self.ts, t) - 1
        if i >= len(self.ts) - 1:
            return self.vs[-1]
        t0, t1 = self.ts[i], self.ts[i + 1]
        v0, v1 = self.vs[i], self.vs[i + 1]
        if t1 == t0:
            return v1
        return v0 + (v1 - v0) * (t - t0) / (t1 - t0)

    def anchor_at(self, t: int, window_end: int):
        """Equity anchor for a window starting at t: interpolated value, or the
        first sample if the account began after t but inside the window."""
        v = self.value_at(t)
        if v is not None:
            return v, False
        if self.ts and t < self.ts[0] <= window_end:
            return self.vs[0], True
        return None, False

    def bracket_max(self, t: int):
        """Max of the two samples bracketing t. Used for the exposure
        denominator: interpolation under-reads equity in the hours after a
        deposit (samples are ~11 days apart) and would manufacture impossible
        exposure readings (hundreds of times equity on a 50x-max venue)."""
        if not self.ts or t < self.ts[0] or t > self.ts[-1]:
            return None
        i = bisect.bisect_right(self.ts, t) - 1
        j = min(i + 1, len(self.ts) - 1)
        return max(self.vs[i], self.vs[j])


# ── Per-wallet preprocessing ────────────────────────────────────────────────

def fee_usd(f: dict) -> float:
    """Fee in USD: as reported when the fee token is USDC (perps and most
    spot), else approximated as fee × price (fee paid in the base token)."""
    fee = float(f.get("fee") or 0)
    tok = f.get("feeToken") or "USDC"
    return fee if tok == "USDC" else fee * float(f["px"])


class WalletData:
    """Everything G0 and book accounting need, precomputed once per wallet."""

    def __init__(self, address: str, archetype: str, fills: list[dict],
                 complete: bool, portfolio: dict):
        self.address = address
        self.archetype = archetype
        self.fetch_complete = complete
        self.avh = SampledSeries(splice_perp_series(portfolio, "avh", align=False))
        self.pnl = SampledSeries(splice_perp_series(portfolio, "pnl", align=True))
        fills = [f for f in fills if not is_spot(f["coin"])]  # perp scope
        self.n_fills = len(fills)
        self.first_ts = fills[0]["time"] if fills else None
        self.last_ts = fills[-1]["time"] if fills else None

        by_coin: dict[str, list[dict]] = defaultdict(list)
        for f in fills:
            by_coin[f["coin"]].append(f)

        self.truncated_coins: set[str] = set()
        for coin, cfills in by_coin.items():
            if abs(float(cfills[0].get("startPosition") or 0)) > POSITION_EPS:
                self.truncated_coins.add(coin)

        # Chronological arrays over ALL fills (window slicing by bisect).
        self.fill_times = [f["time"] for f in fills]
        self.fill_pnl_net = [float(f.get("closedPnl") or 0) - fee_usd(f) for f in fills]
        self.liq_times = [f["time"] for f in fills if f["liq"]]
        self.trunc_fill_times = [f["time"] for f in fills
                                 if f["coin"] in self.truncated_coins]

        # Distinct active days and per-day traded notional.
        day_notional: dict[int, float] = defaultdict(float)
        for f in fills:
            day_notional[f["time"] // DAY_MS] += abs(float(f["sz"])) * float(f["px"])
        self.days = sorted(day_notional)
        self.day_notional = [day_notional[d] for d in self.days]

        # Exposure records: post-fill position notional as a fraction of equity
        # at the fill time, for position-increasing fills. Only fractions
        # ≥ 0.20 are kept (every battery threshold is ≥ 0.32); windows with no
        # stored record have max exposure below every threshold.
        self.exp_times: list[int] = []
        self.exp_fracs: list[float] = []

        # Round trips over complete-history coins only.
        trips: list[dict] = []
        for coin, cfills in by_coin.items():
            if coin in self.truncated_coins:
                continue
            pos = 0.0
            cur = None
            for f in cfills:
                sz = float(f["sz"])
                px = float(f["px"])
                delta = sz if f["side"] == "B" else -sz
                reported = f.get("startPosition")
                prev = float(reported) if reported is not None else pos
                new = prev + delta
                pos = 0.0 if abs(new) < POSITION_EPS else new
                prev_flat = abs(prev) < POSITION_EPS
                new_flat = abs(new) < POSITION_EPS
                flipped = (not prev_flat and not new_flat and (prev > 0) != (new > 0))
                increasing = abs(new) > abs(prev) + POSITION_EPS

                if increasing:
                    eq = self.avh.bracket_max(f["time"]) if self.avh else None
                    if eq is not None and eq > 0:
                        frac = abs(new) * px / eq
                        if frac >= 0.20:
                            self.exp_times.append(f["time"])
                            self.exp_fracs.append(frac)

                if prev_flat and not new_flat:
                    cur = {"open_ts": f["time"], "entry_notional": abs(delta) * px,
                           "pnl": float(f.get("closedPnl") or 0) - fee_usd(f)}
                elif cur is not None:
                    cur["pnl"] += float(f.get("closedPnl") or 0) - fee_usd(f)
                    if increasing:
                        cur["entry_notional"] += abs(delta) * px
                    if new_flat or flipped:
                        cur["close_ts"] = f["time"]
                        trips.append(cur)
                        cur = {"open_ts": f["time"], "entry_notional": abs(new) * px,
                               "pnl": 0.0} if flipped else None
            # an open position at end of data is not a resolved round trip

        # Exposure records were appended per coin: restore global time order
        # so window slicing by bisect is valid.
        if self.exp_times:
            pairs = sorted(zip(self.exp_times, self.exp_fracs))
            self.exp_times = [p[0] for p in pairs]
            self.exp_fracs = [p[1] for p in pairs]

        trips.sort(key=lambda t: t["close_ts"])
        self.trip_close_ts = [t["close_ts"] for t in trips]
        self.trip_open_ts = [t["open_ts"] for t in trips]
        self.trip_notional = [t["entry_notional"] for t in trips]
        self.trip_pnl = [t["pnl"] for t in trips]
        # Trip order by open time, for post-loss sequencing.
        self.by_open = sorted(range(len(trips)), key=lambda i: self.trip_open_ts[i])
        self.open_ts_sorted = [self.trip_open_ts[i] for i in self.by_open]

    # ── window metrics (thresholds are applied later, once per config) ──────
    def metrics_at(self, t_ms: int):
        """Raw G0 metrics for the trailing 60d window ending at t_ms, or an
        exclusion reason when the window cannot be honestly evaluated."""
        w0 = t_ms - EVAL_WINDOW_DAYS * DAY_MS
        if not self.fetch_complete:
            return {"excluded": "fills_fetch_incomplete"}
        lo = bisect.bisect_right(self.fill_times, w0)
        hi = bisect.bisect_right(self.fill_times, t_ms)
        if hi <= lo:
            return {"excluded": "no_fills_in_window"}
        tl = bisect.bisect_right(self.trunc_fill_times, w0)
        th = bisect.bisect_right(self.trunc_fill_times, t_ms)
        if th > tl:
            return {"excluded": "truncated_coin_traded_in_window"}
        if not self.avh:
            return {"excluded": "no_equity_history"}
        anchor, clamped = self.avh.anchor_at(w0, t_ms)
        if anchor is None or anchor <= 0:
            return {"excluded": "no_equity_anchor_at_window_start"}
        if anchor < EQUITY_ANCHOR_FLOOR:
            # A near-zero window-start equity (account funded mid-window)
            # makes every ratio metric degenerate: the wallet-date cannot be
            # honestly evaluated — excluded and logged, not failed or guessed.
            return {"excluded": f"equity_anchor_below_{int(EQUITY_ANCHOR_FLOOR)}"}

        # Resolved round trips in window.
        rlo = bisect.bisect_right(self.trip_close_ts, w0)
        rhi = bisect.bisect_right(self.trip_close_ts, t_ms)
        n_trips = rhi - rlo
        # Distinct active days.
        d0 = bisect.bisect_left(self.days, (w0 // DAY_MS) + (1 if w0 % DAY_MS else 0))
        d1 = bisect.bisect_right(self.days, (t_ms - 1) // DAY_MS)
        active_days = d1 - d0
        # Realized-equity drawdown (anchor + cumulative closedPnl − fees; the
        # reconstruction excludes funding payments and unrealized excursions —
        # disclosed in the report).
        equity = peak = anchor
        max_dd = 0.0
        for i in range(lo, hi):
            equity += self.fill_pnl_net[i]
            if equity > peak:
                peak = equity
            dd = peak - equity
            if dd > max_dd:
                max_dd = dd
        dd_frac = max_dd / anchor
        # Sizing consistency: CV of per-trade entry notional, resolved trips.
        notionals = self.trip_notional[rlo:rhi]
        cv = None
        if len(notionals) >= 2:
            mean = sum(notionals) / len(notionals)
            if mean > 0:
                cv = statistics.stdev(notionals) / mean
        # Post-loss behavior: pool the 3 trades (by open time) following each
        # losing close in the window; median pooled size vs window median.
        postloss_ratio = None
        if notionals:
            window_median = statistics.median(notionals)
            pool: list[float] = []
            for i in range(rlo, rhi):
                if self.trip_pnl[i] >= 0:
                    continue
                c = self.trip_close_ts[i]
                j = bisect.bisect_right(self.open_ts_sorted, c)
                taken = 0
                while j < len(self.by_open) and taken < 3:
                    k = self.by_open[j]
                    if self.trip_open_ts[k] <= t_ms:
                        pool.append(self.trip_notional[k])
                        taken += 1
                    else:
                        break
                    j += 1
            if pool and window_median > 0:
                postloss_ratio = statistics.median(pool) / window_median
        # Exposure discipline: max post-fill position notional / equity.
        elo = bisect.bisect_right(self.exp_times, w0)
        ehi = bisect.bisect_right(self.exp_times, t_ms)
        exposure_max = max(self.exp_fracs[elo:ehi], default=0.0)
        # Liquidation events in window.
        n_liq = (bisect.bisect_right(self.liq_times, t_ms)
                 - bisect.bisect_right(self.liq_times, w0))
        # Capacity: median daily traded notional over active days in window.
        med_daily = statistics.median(self.day_notional[d0:d1]) if d1 > d0 else 0.0

        return {"excluded": None, "n_trips": n_trips, "active_days": active_days,
                "dd_frac": dd_frac, "cv": cv, "postloss_ratio": postloss_ratio,
                "exposure_max": exposure_max, "n_liq": n_liq,
                "med_daily_notional": med_daily, "anchor": anchor,
                "anchor_clamped": clamped}

    def period_return(self, t0: int, t1: int):
        """Wallet return over (t0, t1]: Δ cumulative pnl ÷ equity at t0.
        Primary source: portfolio histories (funding + unrealized included,
        ~11-day sampling interpolated). Fallback: realized pnl from fills.
        Returns (r, source) or (None, exclusion_reason)."""
        eq0 = self.avh.value_at(t0) if self.avh else None
        if eq0 is None:
            return None, "excluded:no_equity_at_period_start"
        if eq0 < EQUITY_ANCHOR_FLOOR:
            return None, f"excluded:equity_below_{int(EQUITY_ANCHOR_FLOOR)}_floor"
        p0 = self.pnl.value_at(t0) if self.pnl else None
        p1 = self.pnl.value_at(t1) if self.pnl else None
        if p0 is not None and p1 is not None:
            return (p1 - p0) / eq0, "portfolio"
        lo = bisect.bisect_right(self.fill_times, t0)
        hi = bisect.bisect_right(self.fill_times, t1)
        realized = sum(self.fill_pnl_net[lo:hi])
        return realized / eq0, "fills"


# ── G0 gate (pure threshold comparison over precomputed metrics) ────────────

def passes_floor(m: dict, cfg: dict) -> bool:
    return (m["excluded"] is None
            and m["n_trips"] >= cfg["min_round_trips"]
            and m["active_days"] >= cfg["min_active_days"])


def passes_g0(m: dict, cfg: dict) -> bool:
    if not passes_floor(m, cfg):
        return False
    if m["dd_frac"] > cfg["max_dd_frac"]:
        return False
    if m["cv"] is not None and m["cv"] > cfg["max_size_cv"]:
        return False
    if m["postloss_ratio"] is not None and m["postloss_ratio"] > cfg["max_postloss_ratio"]:
        return False
    if m["exposure_max"] > cfg["max_exposure_frac"]:
        return False
    if m["n_liq"] > cfg["max_liquidations"]:
        return False
    return True


# ── Calendar ────────────────────────────────────────────────────────────────

def month_start(dt: datetime) -> datetime:
    return dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def next_month(dt: datetime) -> datetime:
    return month_start(dt + timedelta(days=32))


def ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


def month_boundaries(first_fill_ms: int, now_ms: int) -> list[int]:
    """Candidate monthly decision dates: month starts from (earliest fill +
    eval window) through the second-to-last completed month boundary, so every
    forward period is a complete calendar month."""
    start = datetime.fromtimestamp((first_fill_ms + EVAL_WINDOW_DAYS * DAY_MS) / 1000,
                                   tz=timezone.utc)
    t = next_month(start - timedelta(days=1))
    last_boundary = month_start(datetime.fromtimestamp(now_ms / 1000, tz=timezone.utc))
    out = []
    while ms(t) < ms(last_boundary):
        out.append(ms(t))
        t = next_month(t)
    return out


# ── Book engine ─────────────────────────────────────────────────────────────

def run_walkforward(wallets: list[WalletData], decisions: list[int], cfg: dict,
                    metrics_cache: dict, return_cache: dict,
                    skip_contribution=None):
    """One full walk-forward pass under a G0 configuration. Returns
    {periods: [...], book_returns: [...], grad_counts: [...]}. Each period dict
    carries per-wallet rows for the CSVs. skip_contribution=(t_ms, address)
    removes that single wallet-period's contribution (robustness variant a)."""
    periods = []
    for i, t in enumerate(decisions):
        t_next = decisions[i + 1] if i + 1 < len(decisions) else ms(
            next_month(datetime.fromtimestamp(t / 1000, tz=timezone.utc)))
        graduated = []
        for w in wallets:
            m = metrics_cache[(w.address, t)]
            if passes_g0(m, cfg):
                graduated.append(w)
        n = len(graduated)
        weight = min(1.0 / n, PER_WALLET_CAP) if n else 0.0
        rows = []
        book_r = 0.0
        unmeasured_weight = 0.0
        for w in graduated:
            key = (w.address, t, t_next)
            if key not in return_cache:
                return_cache[key] = w.period_return(t, t_next)
            r, source = return_cache[key]
            m = metrics_cache[(w.address, t)]
            haircut = (CAPACITY_HAIRCUT
                       if m["med_daily_notional"] > CAPACITY_MEDIAN_DAILY_NOTIONAL
                       else 0.0)
            if r is None:
                unmeasured_weight += weight
                rows.append({"wallet": w.address, "archetype": w.archetype,
                             "weight": weight, "haircut": haircut, "source": source,
                             "period_return": None, "contribution": None})
                continue
            contrib = weight * r * (1.0 - haircut)
            if skip_contribution == (t, w.address):
                rows.append({"wallet": w.address, "archetype": w.archetype,
                             "weight": weight, "haircut": haircut,
                             "source": source + "|removed_best_variant",
                             "period_return": r, "contribution": 0.0})
                continue
            book_r += contrib
            rows.append({"wallet": w.address, "archetype": w.archetype,
                         "weight": weight, "haircut": haircut, "source": source,
                         "period_return": r, "contribution": contrib})
        # Penny reconciliation: book return must equal the sum of contributions.
        resid = abs(book_r - sum(r["contribution"] or 0.0 for r in rows))
        if resid > 1e-9:
            sys.exit(f"RECONCILIATION FAILURE at {iso(t)}: residual {resid}")
        periods.append({"t": t, "t_next": t_next, "n_graduated": n,
                        "weight": weight, "cash": max(0.0, 1.0 - weight * n),
                        "book_return": book_r, "rows": rows,
                        "unmeasured_weight": unmeasured_weight,
                        "reconciliation_residual": resid})
    return periods


def iso(t_ms: int) -> str:
    return datetime.fromtimestamp(t_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def sharpe(returns: list[float]):
    if len(returns) < 2:
        return None
    mean = sum(returns) / len(returns)
    sd = statistics.stdev(returns)
    if sd == 0:
        return None
    return mean / sd * ANNUALIZE


def max_drawdown(returns: list[float]) -> float:
    eq = peak = 1.0
    mdd = 0.0
    for r in returns:
        eq *= (1.0 + r)
        peak = max(peak, eq)
        if peak > 0:
            mdd = max(mdd, 1.0 - eq / peak)
    return mdd


def series_return(series_pnl: SampledSeries, series_avh: SampledSeries,
                  t0: int, t1: int):
    p0, p1 = series_pnl.value_at(t0), series_pnl.value_at(t1)
    e0 = series_avh.value_at(t0)
    if p0 is None or p1 is None or e0 is None or e0 <= 0:
        return None
    return (p1 - p0) / e0


def ols_alpha_beta(y: list[float], x: list[float]):
    n = len(y)
    if n < 3 or len(x) != n:
        return None, None
    mx = sum(x) / n
    my = sum(y) / n
    sxx = sum((a - mx) ** 2 for a in x)
    if sxx == 0:
        return None, None
    beta = sum((a - mx) * (b - my) for a, b in zip(x, y)) / sxx
    return my - beta * mx, beta


def expected_max_sharpe(trial_srs: list[float]) -> float:
    """E[max SR] inflation across N examined configurations
    (Bailey & López de Prado deflation term): sqrt(Var[SR across trials]) ×
    ((1−γ)·Φ⁻¹(1−1/N) + γ·Φ⁻¹(1−1/(N·e))), γ = Euler–Mascheroni."""
    n = len(trial_srs)
    if n < 2:
        return 0.0
    var = statistics.pvariance(trial_srs)
    if var <= 0:
        return 0.0
    g = 0.5772156649015329
    nd = statistics.NormalDist()
    return math.sqrt(var) * ((1 - g) * nd.inv_cdf(1 - 1 / n)
                             + g * nd.inv_cdf(1 - 1 / (n * math.e)))


# ── Main ────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="MERIT P0 graduated-book backtest")
    ap.add_argument("--coverage-only", action="store_true",
                    help="print the honest data coverage report and stop")
    ap.add_argument("--confirm-low-power", action="store_true",
                    help="operator confirmation to proceed when the window is "
                         "under 18 months (verdict carries the LOW-POWER flag)")
    ap.add_argument("--limit", type=int, default=0,
                    help="DEV ONLY: cap the wallet universe for a smoke run; "
                         "results produced with --limit are not the test")
    args = ap.parse_args()

    t_start = time.time()
    now_ms = int(time.time() * 1000)
    print("=" * 74)
    print("MERIT P0 — GRADUATED-BOOK BACKTEST (docs/merit_p0_backtest_spec.md v1.0)")
    print("=" * 74)
    print("Hypothesis (pre-registered): process-quality selection (G0) beats")
    print("passive HLP exposure risk-adjusted, with lower drawdown. No profit")
    print("target, Sharpe threshold, or PnL rank enters G0.")

    universe = fetch_universe()
    if args.limit:
        universe = universe[:args.limit]
        print(f"\n*** DEV SMOKE RUN: universe capped at {args.limit} — NOT the test ***")
    print(f"\nUniverse: {len(universe)} classified directional wallets "
          f"(market makers excluded: history not fully retrievable, maker flow "
          f"not the underwriting target).")

    # ── Fetch + preprocess ──────────────────────────────────────────────────
    wallets: list[WalletData] = []
    fetch_log: list[str] = []
    for i, row in enumerate(universe):
        addr = row["address"]
        fills, complete = fetch_fills(addr)
        portfolio = fetch_portfolio(addr)
        if not fills:
            fetch_log.append(f"{addr} no fills retrievable — excluded from universe")
            continue
        wd = WalletData(addr, row["archetype"], fills, complete, portfolio)
        if wd.n_fills == 0:
            fetch_log.append(f"{addr} no perp fills (spot-only wallet) — excluded")
            continue
        wallets.append(wd)
        if (i + 1) % 25 == 0:
            print(f"  fetched {i + 1}/{len(universe)} wallets "
                  f"({time.time() - t_start:.0f}s elapsed)")
    print(f"Fetched {len(wallets)} wallets with fills "
          f"({len(universe) - len(wallets)} with none, logged).")

    # ── Decision calendar & per-(wallet, T) metrics ─────────────────────────
    earliest = min(w.first_ts for w in wallets)
    decisions_all = month_boundaries(earliest, now_ms)
    metrics_cache: dict = {}
    for w in wallets:
        for t in decisions_all:
            metrics_cache[(w.address, t)] = w.metrics_at(t)

    # ── Honest data coverage report ─────────────────────────────────────────
    print("\n" + "=" * 74)
    print("HONEST DATA COVERAGE REPORT (printed before any result)")
    print("=" * 74)
    print("Eligibility floor per decision date: ≥60 resolved round trips and")
    print("≥30 active days in the trailing 60d window, complete verified history")
    print("(startPosition validation), equity anchor servable.")
    print(f"\n{'decision':>10}  {'active':>6}  {'excluded':>8}  {'eligible':>8}  "
          f"{'graduated(G0)':>13}")
    coverage_rows = []
    for t in decisions_all:
        active = excluded = eligible = graduated = 0
        for w in wallets:
            m = metrics_cache[(w.address, t)]
            if m["excluded"] == "no_fills_in_window":
                continue
            active += 1
            if m["excluded"] is not None:
                excluded += 1
                continue
            if passes_floor(m, G0_DEFAULT):
                eligible += 1
                if passes_g0(m, G0_DEFAULT):
                    graduated += 1
        coverage_rows.append({"decision_date": iso(t), "t": t, "active": active,
                              "excluded": excluded, "eligible": eligible,
                              "graduated_headline": graduated})
        print(f"{iso(t):>10}  {active:>6}  {excluded:>8}  {eligible:>8}  {graduated:>13}")

    # Longest verified-contiguous run of decision dates with ≥1 eligible wallet.
    best_start = best_len = cur_start = cur_len = 0
    for i, row in enumerate(coverage_rows):
        if row["eligible"] >= 1:
            if cur_len == 0:
                cur_start = i
            cur_len += 1
            if cur_len > best_len:
                best_len, best_start = cur_len, cur_start
        else:
            cur_len = 0
    if best_len == 0:
        sys.exit("\nNo decision date has a single eligible wallet — the data "
                 "cannot support this test. Stopping.")
    run_rows = coverage_rows[best_start:best_start + best_len]
    decisions = [r["t"] for r in run_rows]
    window_months = best_len
    dropped = [r["decision_date"] for r in coverage_rows
               if r["t"] not in set(decisions)]
    low_power = window_months < MIN_WINDOW_MONTHS

    window_end = ms(next_month(datetime.fromtimestamp(decisions[-1] / 1000,
                                                      tz=timezone.utc)))
    print(f"\nLongest verified-contiguous window: {run_rows[0]['decision_date']} → "
          f"{iso(window_end)} "
          f"({window_months} monthly decision dates, {window_months} forward months)")
    if dropped:
        print(f"Dropped decision dates outside the contiguous window ({len(dropped)}): "
              f"{', '.join(dropped)}")
    print(f"Mean eligible wallets across the window: "
          f"{sum(r['eligible'] for r in run_rows) / len(run_rows):.1f}; "
          f"mean graduated (headline G0): "
          f"{sum(r['graduated_headline'] for r in run_rows) / len(run_rows):.1f}")
    print(f"18-month requirement: window is {window_months} months → "
          f"{'UNDER 18 MONTHS — LOW-POWER' if low_power else 'met'}")

    with open(RESULTS / "coverage.csv", "w", newline="") as fh:
        wcsv = csv.DictWriter(fh, fieldnames=["decision_date", "active", "excluded",
                                              "eligible", "graduated_headline",
                                              "in_walkforward_window"])
        wcsv.writeheader()
        for r in coverage_rows:
            wcsv.writerow({"decision_date": r["decision_date"], "active": r["active"],
                           "excluded": r["excluded"], "eligible": r["eligible"],
                           "graduated_headline": r["graduated_headline"],
                           "in_walkforward_window": r["t"] in set(decisions)})

    if args.coverage_only:
        print("\n--coverage-only: stopping here as requested.")
        return
    if low_power and not args.confirm_low_power:
        print("\n" + "!" * 74)
        print(f"STOP: the honest window is {window_months} months (< {MIN_WINDOW_MONTHS}).")
        print("Per spec §7 a binding verdict wants the S3 deep backfill (Option 3).")
        print("Re-run with --confirm-low-power to proceed; the verdict will carry")
        print("the explicit LOW-POWER flag. Not proceeding without confirmation.")
        print("!" * 74)
        sys.exit(3)

    # ── Benchmark + factor series ───────────────────────────────────────────
    hlp = fetch_hlp_series()
    hlp_pnl = SampledSeries(hlp["pnl"])
    hlp_avh = SampledSeries(hlp["avh"])
    candles = CandleStore()

    boundaries = decisions + [ms(next_month(
        datetime.fromtimestamp(decisions[-1] / 1000, tz=timezone.utc)))]
    hlp_returns = []
    btc_returns = []
    for t0, t1 in zip(boundaries[:-1], boundaries[1:]):
        r = series_return(hlp_pnl, hlp_avh, t0, t1)
        if r is None:
            sys.exit(f"HLP benchmark not servable for {iso(t0)}→{iso(t1)} — the "
                     "identical-window comparison is impossible. Stopping.")
        hlp_returns.append(r)
        c0 = candles.open_at_or_after("BTC", t0, 3 * DAY_MS)
        c1 = candles.open_at_or_after("BTC", t1, 3 * DAY_MS)
        btc_returns.append((c1[1] / c0[1] - 1.0) if c0 and c1 else None)

    # ── Headline walk-forward ───────────────────────────────────────────────
    return_cache: dict = {}
    headline = run_walkforward(wallets, decisions, G0_DEFAULT,
                               metrics_cache, return_cache)
    book_returns = [p["book_return"] for p in headline]
    grad_counts = [p["n_graduated"] for p in headline]
    avg_breadth = sum(grad_counts) / len(grad_counts)

    sr_book = sharpe(book_returns)
    sr_hlp = sharpe(hlp_returns)
    dd_book = max_drawdown(book_returns)
    dd_hlp = max_drawdown(hlp_returns)

    # ── Robustness battery (spec §6.4) ──────────────────────────────────────
    battery = []  # (label, cfg)
    for key in PERTURB_KEYS:
        for sign, tag in ((1 - PERTURB_FRAC, "-20%"), (1 + PERTURB_FRAC, "+20%")):
            cfg = dict(G0_DEFAULT)
            cfg[key] = (max(1, round(G0_DEFAULT[key] * sign))
                        if isinstance(G0_DEFAULT[key], int)
                        else G0_DEFAULT[key] * sign)
            battery.append((f"{key} {tag} ({cfg[key]:g})", cfg))

    headline_adv = (sr_book or 0.0) - (sr_hlp or 0.0)
    headline_sign = headline_adv > 0
    trial_srs = [sr_book] if sr_book is not None else []

    # (c) G0 thresholds perturbed ±20%, one at a time (full walk-forward re-run).
    thresh_rows = []
    for label, cfg in battery:
        periods = run_walkforward(wallets, decisions, cfg, metrics_cache, return_cache)
        rets = [p["book_return"] for p in periods]
        sr = sharpe(rets)
        adv = (sr or 0.0) - (sr_hlp or 0.0)
        thresh_rows.append({"variant": f"(c) {label}", "book_sharpe": sr,
                            "hlp_sharpe": sr_hlp, "advantage": adv,
                            "avg_graduated": sum(p["n_graduated"] for p in periods) / len(periods),
                            "sign_survives": (adv > 0) == headline_sign})
        if sr is not None:
            trial_srs.append(sr)
    thresh_survives = all(r["sign_survives"] for r in thresh_rows)

    # (a) removal of the single best wallet-period.
    best_contrib, best_key = 0.0, None
    for p in headline:
        for r in p["rows"]:
            if r["contribution"] is not None and r["contribution"] > best_contrib:
                best_contrib = r["contribution"]
                best_key = (p["t"], r["wallet"])
    if best_key is not None:
        periods_a = run_walkforward(wallets, decisions, G0_DEFAULT, metrics_cache,
                                    return_cache, skip_contribution=best_key)
        sr_a = sharpe([p["book_return"] for p in periods_a])
        adv_a = (sr_a or 0.0) - (sr_hlp or 0.0)
        surv_a = (adv_a > 0) == headline_sign
        label_a = (f"(a) remove best wallet-period "
                   f"({best_key[1][:10]}…@{iso(best_key[0])}, +{best_contrib*100:.2f}%)")
    else:
        sr_a, adv_a, surv_a = sr_book, headline_adv, True
        label_a = "(a) remove best wallet-period (no positive contribution found)"
    row_a = {"variant": label_a, "book_sharpe": sr_a, "hlp_sharpe": sr_hlp,
             "advantage": adv_a, "avg_graduated": avg_breadth,
             "sign_survives": surv_a}

    # (b) first-half vs second-half split.
    half = len(book_returns) // 2
    rows_b = []
    halves = []
    for tag, sl in (("first half", slice(0, half)), ("second half", slice(half, None))):
        sr_h = sharpe(book_returns[sl])
        sr_hlp_h = sharpe(hlp_returns[sl])
        adv_h = (sr_h or 0.0) - (sr_hlp_h or 0.0)
        surv = (adv_h > 0) == headline_sign
        halves.append(surv)
        rows_b.append({"variant": f"(b) {tag} ({len(book_returns[sl])} months)",
                       "book_sharpe": sr_h, "hlp_sharpe": sr_hlp_h,
                       "advantage": adv_h, "avg_graduated": None,
                       "sign_survives": surv})

    robustness_rows = [row_a] + rows_b + thresh_rows
    k4_pass = surv_a and all(halves) and thresh_survives

    # ── Deflated Sharpe (kill criterion 1) ──────────────────────────────────
    n_configs = 1 + len(battery)
    emax = expected_max_sharpe(trial_srs)
    sr_deflated = (sr_book - emax) if sr_book is not None else None

    # ── Kill criteria ───────────────────────────────────────────────────────
    k1 = (sr_deflated is not None and sr_hlp is not None and sr_deflated > sr_hlp)
    k2 = dd_book < dd_hlp
    k3 = avg_breadth >= MIN_BOOK_BREADTH
    if k1 and k2 and k4_pass:
        verdict = "PASS" if k3 else "INCONCLUSIVE"
    else:
        verdict = "FAIL"

    # BTC alpha (reported, not gating).
    pairs = [(b, x) for b, x in zip(book_returns, btc_returns) if x is not None]
    alpha, beta = ols_alpha_beta([p[0] for p in pairs], [p[1] for p in pairs])

    # ── Outputs ─────────────────────────────────────────────────────────────
    write_outputs(headline, robustness_rows, coverage_rows, decisions, boundaries,
                  book_returns, hlp_returns, btc_returns, metrics_cache, wallets,
                  return_cache, fetch_log)

    max_resid = max(p["reconciliation_residual"] for p in headline)
    unmeasured = [(iso(p["t"]), p["unmeasured_weight"]) for p in headline
                  if p["unmeasured_weight"] > 0]

    verdict_lines = []
    add = verdict_lines.append
    add("=" * 74)
    add("MERIT P0 VERDICT — pre-registered kill criteria (spec §6), headline G0")
    add("=" * 74)
    add(f"Walk-forward window: {iso(decisions[0])} → {iso(boundaries[-1])} "
        f"({window_months} monthly periods)")
    lp_text = ("YES — window under 18 months; S3 deep backfill is the "
               "prerequisite for a binding verdict (spec §7)") if low_power else "no"
    add(f"LOW-POWER flag: {lp_text}")
    add(f"Book monthly returns: n={len(book_returns)}; HLP identical calendar windows.")
    add("")
    add(f"K1 deflated Sharpe > HLP Sharpe:")
    add(f"    book Sharpe (ann.)      = {fmtf(sr_book)}")
    add(f"    deflation haircut       = {emax:.4f}  (E[max SR] across "
        f"{n_configs} examined G0 configurations, Bailey–López de Prado term)")
    add(f"    book deflated Sharpe    = {fmtf(sr_deflated)}")
    add(f"    HLP Sharpe (ann.)       = {fmtf(sr_hlp)}")
    add(f"    → {'PASS' if k1 else 'FAIL'}")
    add(f"K2 book max drawdown < HLP max drawdown:")
    add(f"    book maxDD = {dd_book*100:.2f}%   HLP maxDD = {dd_hlp*100:.2f}%")
    add(f"    → {'PASS' if k2 else 'FAIL'}")
    add(f"K3 breadth ≥ {MIN_BOOK_BREADTH:.0f} graduated wallets on average:")
    add(f"    average graduated = {avg_breadth:.1f} "
        f"(min {min(grad_counts)}, max {max(grad_counts)})")
    add(f"    → {'PASS' if k3 else 'FAIL → verdict capped at INCONCLUSIVE, not PASS'}")
    add(f"K4 robustness — sign of Sharpe advantage survives:")
    add(f"    (a) remove best wallet-period: {'survives' if surv_a else 'FLIPS'}")
    add(f"    (b) half-split: first {'survives' if halves[0] else 'FLIPS'}, "
        f"second {'survives' if halves[1] else 'FLIPS'}")
    n_thresh_surv = sum(1 for r in thresh_rows if r["sign_survives"])
    add(f"    (c) thresholds ±20% one at a time: "
        f"{n_thresh_surv}/{len(battery)} survive")
    k4_text = ("PASS" if k4_pass
               else "FAIL (a flip on any variant is curve fitting per spec §6.4)")
    add(f"    → {k4_text}")
    add("")
    add(f"VERDICT: {verdict}{' [LOW-POWER]' if low_power else ''}")
    add("")
    add(f"Reported, not gating — book vs BTC factor: "
        f"alpha={fmtf(alpha, pct=True)}/month, beta={fmtf(beta)}")
    add(f"Penny reconciliation: max period residual {max_resid:.2e} (must be <1e-9).")
    if unmeasured:
        add(f"Unmeasured graduated weight (excluded, reported, never zero-filled): "
            f"{', '.join(f'{d}:{w*100:.1f}%' for d, w in unmeasured)}")
    add("")
    add("data_coverage: window served as above. Scope: the perp account only —")
    add("spot pairs are excluded by construction (spot balances move by transfer,")
    add("so fills-based completeness validation is impossible for them); wallet")
    add("returns and equity anchors use perpAllTime portfolio histories, extended")
    add("into the pre-2024-05 spot-free era by allTime samples (spliced,")
    add("pnl offset-aligned at the boundary). Granularity mix: portfolio series")
    add("are ~11-day API samples interpolated at month boundaries, with")
    add("fills-reconstructed realized-pnl fallback; G0 drawdown/exposure use")
    add("fills-reconstructed realized equity (funding payments and unrealized")
    add("excursions not captured — disclosed limitation); HLP from the public")
    add("vault allTime history (~12.5-day sampling); both sides gross of fund")
    add("fees, identical accounting. Excluded wallets/dates: see exclusions.csv.")
    add("Ledger publication: separate step, pending operator decision (spec §8);")
    add("allocation books are outside rule grammar v1.")

    block = "\n".join(verdict_lines)
    print("\n" + block)
    (RESULTS / "verdict.txt").write_text(block + "\n")
    print(f"\nCSVs written to {RESULTS}/. Runtime {time.time() - t_start:.0f}s.")


def fmtf(v, pct=False):
    if v is None:
        return "—"
    return f"{v*100:.3f}%" if pct else f"{v:.4f}"


def write_outputs(headline, robustness_rows, coverage_rows, decisions, boundaries,
                  book_returns, hlp_returns, btc_returns, metrics_cache, wallets,
                  return_cache, fetch_log):
    # Per-period book CSVs (the receipt: one CSV per decision period).
    for stale in RESULTS.glob("book_*.csv"):
        stale.unlink()
    for p in headline:
        name = datetime.fromtimestamp(p["t"] / 1000, tz=timezone.utc).strftime("%Y-%m")
        with open(RESULTS / f"book_{name}.csv", "w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=["wallet", "archetype", "weight",
                                               "haircut", "source",
                                               "period_return", "contribution"])
            w.writeheader()
            for r in p["rows"]:
                w.writerow(r)

    # Equity curves + period summary.
    with open(RESULTS / "book_periods.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["period_start", "period_end", "n_graduated", "per_wallet_weight",
                    "cash_weight", "unmeasured_weight", "book_return", "hlp_return",
                    "btc_return", "book_equity", "hlp_equity"])
        eq_b = eq_h = 1.0
        for p, rb, rh, rx in zip(headline, book_returns, hlp_returns, btc_returns):
            eq_b *= (1 + rb)
            eq_h *= (1 + rh)
            w.writerow([iso(p["t"]), iso(p["t_next"]), p["n_graduated"],
                        f"{p['weight']:.6f}", f"{p['cash']:.6f}",
                        f"{p['unmeasured_weight']:.6f}", f"{rb:.8f}", f"{rh:.8f}",
                        f"{rx:.8f}" if rx is not None else "",
                        f"{eq_b:.6f}", f"{eq_h:.6f}"])

    # Per-wallet contribution table with capacity haircuts and sources.
    agg: dict = defaultdict(lambda: {"periods": 0, "total_contribution": 0.0,
                                     "haircut_periods": 0, "sources": set(),
                                     "archetype": ""})
    for p in headline:
        for r in p["rows"]:
            a = agg[r["wallet"]]
            a["periods"] += 1
            a["archetype"] = r["archetype"]
            a["total_contribution"] += r["contribution"] or 0.0
            if r["haircut"]:
                a["haircut_periods"] += 1
            a["sources"].add(r["source"])
    with open(RESULTS / "contributions.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["wallet", "archetype", "periods_in_book", "total_contribution",
                    "capacity_haircut_periods", "return_sources"])
        for addr, a in sorted(agg.items(), key=lambda kv: -kv[1]["total_contribution"]):
            w.writerow([addr, a["archetype"], a["periods"],
                        f"{a['total_contribution']:.8f}", a["haircut_periods"],
                        "|".join(sorted(a["sources"]))])

    # Robustness battery table.
    with open(RESULTS / "robustness.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["variant", "book_sharpe", "hlp_sharpe", "sharpe_advantage",
                    "avg_graduated", "sign_survives"])
        for r in robustness_rows:
            w.writerow([r["variant"],
                        fmtf(r["book_sharpe"]), fmtf(r["hlp_sharpe"]),
                        fmtf(r["advantage"]),
                        f"{r['avg_graduated']:.1f}" if r["avg_graduated"] is not None else "",
                        r["sign_survives"]])

    # Exclusions log (wallet-dates excluded from evaluation, with reasons).
    with open(RESULTS / "exclusions.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["decision_date", "wallet", "reason"])
        for line in fetch_log:
            w.writerow(["", line.split()[0], " ".join(line.split()[1:])])
        for t in decisions:
            for wd in wallets:
                m = metrics_cache[(wd.address, t)]
                if m["excluded"] not in (None, "no_fills_in_window"):
                    w.writerow([iso(t), wd.address, m["excluded"]])

    # Actuarial seed: per-window distribution of graduated-wallet outcomes
    # (spec §9 — the first row of MERIT's loss dataset).
    with open(RESULTS / "actuarial_seed.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["period_start", "period_end", "wallet", "archetype",
                    "forward_return", "weight", "capacity_haircut", "contribution",
                    "outcome"])
        for p in headline:
            for r in p["rows"]:
                fr = r["period_return"]
                outcome = ("unmeasured" if fr is None
                           else "loss" if fr < 0 else "flat" if fr == 0 else "gain")
                w.writerow([iso(p["t"]), iso(p["t_next"]), r["wallet"], r["archetype"],
                            f"{fr:.8f}" if fr is not None else "", f"{r['weight']:.6f}",
                            r["haircut"],
                            f"{r['contribution']:.8f}" if r["contribution"] is not None else "",
                            outcome])


if __name__ == "__main__":
    main()
