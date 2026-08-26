"""
backtest_graduation.py — MERIT P0 graduated-book test, v1.2.

Implements docs/merit_p0_backtest_spec.md (v1.2, 2026-08-26) exactly. The
spec's process score, walk-forward protocol, book construction, kill criteria
and data-coverage rules are binding; nothing here is optimized.

What v1.2 changed from v1.0, and why (spec §0, pre-registered before any
verdict existed):
  1. The five binary G0 gates became a continuous score S. v1.0's pass/fail
     cliffs produced zero graduations on every decision date, so the test
     could only ever return an empty book. S is the equally weighted mean of
     five cross-sectional percentile ranks — one per process dimension —
     which is parameter-free by construction: there is no threshold left in
     this file to fish on.
  2. The universe widened from the classified directional cohort to every
     tracked wallet meeting the eligibility floor, and the window widened to
     whatever the S3 archive backfill supports. S scores observable behavior,
     not our labels.
  3. The book became the top quintile by S, weighted proportionally to S,
     capped at 5 percent per wallet and 50 wallets total.

What did NOT change and may not (spec §0): the four kill criteria, the
walk-forward look-ahead protocol, the eligibility floor, survivorship
inclusion, capacity haircuts, and the HLP benchmark.

What this is NOT: a copy-trading replay. Per spec §1 the book simulates being
the capital behind the wallets, so book returns are the wallets' own realized
returns scaled to allocation. No mirror trades are simulated, so the execution
friction floors (60s delay / 5bps slippage / taker fee) that bind every trade
REPLAY have no execution to attach to here; wallet returns are net of the fees
the wallets themselves actually paid. The frictions that bind this test are
selection honesty, look-ahead prevention, survivorship inclusion, and the
capacity haircut (spec §1, §4).

Data sources (all disclosed per wallet in the outputs):
  - Universe: Supabase `wallets`. Every PostgREST read is paginated — the
    table holds ~7,000 rows and PostgREST truncates near 1,000 without
    erroring (repo invariant).
  - Archive: the Hyperliquid S3 tape, downloaded by s3_backfill.py into the
    local s3_cache/ and read from there. NOTHING FROM THE ARCHIVE IS LOADED
    INTO SUPABASE (spec §7): the hot database receives only results, the
    coverage report and the per-period book CSVs. When the cache is absent the
    run says so in the coverage block and the walk-forward window is bounded
    by the /info API's retention instead — reported, never worked around.
  - Scope: the PERP account. Spot pairs are excluded by construction: spot
    balances also move by transfers, so a fills-based completeness validation
    is structurally impossible for them, and perp trading is what MERIT
    underwrites. Disclosed in the report.
  - Fills: complete lifetime per wallet from the Hyperliquid API
    (userFillsByTime forward pagination), cached locally and merged with the
    archive tape where present. Completeness is validated per wallet+coin via
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
    reported, never coalesced to a 0 return; an eligible wallet-date whose
    window leaves one of the five dimensions UNDEFINED is dropped from scoring
    and logged, never ranked as if the missing dimension were perfect (v1.0
    let an undefined post-loss ratio pass its gate — the read-NULL-as-false
    bug the repo invariant names).
  - Coverage is tracked separately from values, and the served walk-forward
    window is the longest CONTIGUOUS run of qualifying decision dates, with
    every drop reported in data_coverage.
  - Penny reconciliation: every book period return must equal the sum of its
    per-wallet contributions to <1e-9, or the run aborts.
  - The coverage gate (spec §7): if the data cannot produce at least 12
    contiguous qualifying decision dates — a date qualifies at ≥25 eligible
    wallets (spec §4) — the run STOPS and reports rather than degrading.

Usage:
  python3 backtest_graduation.py                  # coverage report, gate, full run
  python3 backtest_graduation.py --coverage-only  # stop after the coverage report
  python3 backtest_graduation.py --universe classified   # narrower diagnostic
  python3 backtest_graduation.py --confirm-low-power     # proceed past the gate
  (reads SUPABASE_URL / SUPABASE_ANON_KEY from env or .env.local)

Outputs: backtest_results/graduation/ (coverage, per-period book CSVs, equity
curves, contributions, robustness battery, score distributions, predictive
validity, exclusions, actuarial seed, verdict.txt) and the verdict block on
stdout.
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

# ── Pre-registered configuration (spec v1.2 §2/§4; binding, never tuned) ────
# v1.2 replaced v1.0's five binary G0 gates with a continuous score. What
# survives is the eligibility floor and the five process dimensions
# themselves. What is gone is every threshold — and with every threshold gone,
# so is every knob this script could have been fished on. That is the point of
# percentile ranking: it is parameter-free by construction (spec §2).
ELIGIBILITY = {
    "min_round_trips": 60,      # resolved round trips in the trailing window
    "min_active_days": 30,      # distinct active days in the trailing window
}

# The five process dimensions of spec §2, mapped to the raw metric that
# WalletData.metrics_at() already produces. Every one is "lower is better", so
# the percentile rank is taken worst-first and better behavior lands at a
# higher percentile (spec §2: "rank ascending so that better behavior means a
# higher percentile"). Equal weights, fixed before the run.
SCORE_DIMS = [
    ("d1_drawdown_control",   "dd_frac"),
    ("d2_sizing_consistency", "cv"),
    ("d3_postloss_composure", "postloss_ratio"),
    ("d4_exposure_mgmt",      "exposure_max"),
    ("d5_liquidation_avoid",  "n_liq"),
]

SELECT_QUANTILE = 0.20          # top quintile by S (spec §4)
SELECT_CAP = 50                 # absolute wallet cap, so the book stays auditable
PER_WALLET_CAP = 0.05           # 5% book cap, cash earns zero (spec §4)
MIN_ELIGIBLE_FOR_QUALIFYING = 25  # breadth floor per decision date (spec §4)
MIN_QUALIFYING_DATES = 12       # coverage gate (spec §7) and kill criterion 3
MIN_BOOK_BREADTH = 15.0         # kill criterion 3: mean wallets in the book

EVAL_WINDOW_DAYS = 60           # trailing eval window at each decision date
FORWARD_FUNDED_DAYS = 90        # graduation funds forward 90d; monthly re-scoring
                                # (spec §3) drops a wallet at the next T when it
                                # leaves the top quintile, so book membership at
                                # each monthly period is that period's selection.
CAPACITY_MEDIAN_DAILY_NOTIONAL = 5_000_000.0
CAPACITY_HAIRCUT = 0.25         # 25% haircut above the line (spec §4)
EQUITY_ANCHOR_FLOOR = 1_000.0   # below this the return denominator is unreliable:
                                # wallet-period excluded and logged, never guessed
ANNUALIZE = math.sqrt(12.0)     # monthly book/benchmark series
ANNUALIZE_DAILY = math.sqrt(365.0)  # daily wallet series (rank-correlation only)

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

# Set by --rehearsal. A rehearsal exercises the whole pipeline on data that
# cannot satisfy the coverage gate, so its outputs must never be mistakable for
# the binding run's: they go to their own directory AND carry a REHEARSAL_
# filename prefix, because a file read out of context still has to say what it
# is. Nothing in this script writes to Supabase or the Ledger in either mode —
# the only POST here is the Hyperliquid /info read endpoint.
REHEARSAL_MODE = False


def R(name: str):
    """Output path, labelled when the run is a rehearsal."""
    return RESULTS / (("REHEARSAL_" + name) if REHEARSAL_MODE else name)
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

def fetch_universe(scope: str = "all") -> list[dict]:
    """The wallet universe. v1.2 §0 change 2 widened this from the classified
    directional cohort to every tracked wallet: S scores observable behavior,
    not our labels, so filtering on an archetype we assigned would put our own
    classification inside the experiment. The eligibility floor does the
    filtering instead.

    The narrower scopes remain available as diagnostics and are labelled as
    such wherever they appear in the outputs. Every read is paginated:
    PostgREST truncates near 1000 rows without erroring, and this table holds
    ~7,000 (repo invariant)."""
    qs = "select=address,archetype"
    if scope == "directional":
        qs += f"&archetype=in.({','.join(DIRECTIONAL)})"
    elif scope == "classified":
        qs += "&archetype=not.is.null"
    rows = sb_page_all("wallets", qs, "address.asc")
    if not rows:
        sys.exit(f"No wallets found in Supabase for universe scope '{scope}'.")
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


# ── The process score S (spec §2 — replaces v1.0's binary G0 gates) ─────────

def passes_floor(m: dict) -> bool:
    """Eligibility floor, unchanged from v1.0 (spec §2)."""
    return (m["excluded"] is None
            and m["n_trips"] >= ELIGIBILITY["min_round_trips"]
            and m["active_days"] >= ELIGIBILITY["min_active_days"])


def percentile_ranks(values: list[float]) -> list[float]:
    """Cross-sectional percentile rank over one dimension where LOWER IS
    BETTER. Ordered worst-first, ties share the average position, so the
    returned percentile rises with better behavior and lands in (0, 1).

    Parameter-free by construction: no threshold, no winsorisation, no
    transform. The only information used is the ordering of that date's
    eligible wallets against each other."""
    n = len(values)
    if n == 0:
        return []
    if n == 1:
        return [0.5]
    order = sorted(range(n), key=lambda i: -values[i])   # worst first
    pos = [0.0] * n
    i = 0
    while i < n:
        j = i
        while j + 1 < n and values[order[j + 1]] == values[order[i]]:
            j += 1
        avg = (i + j) / 2.0
        for k in range(i, j + 1):
            pos[order[k]] = avg
        i = j + 1
    return [(p + 0.5) / n for p in pos]


def score_at(wallets: list, t: int, metrics_cache: dict):
    """Spec §2: every eligible wallet at T gets a percentile rank per
    dimension; S is the equally weighted mean of the five.

    Returns (scored, unscorable). `scored` rows carry the raw metrics, the
    five percentiles, S, and the verified-history length used as the tie
    break. `unscorable` records eligible wallets whose window leaves one of
    the five dimensions undefined.

    On undefined dimensions: a dimension that cannot be measured is the
    ABSENCE of a measurement, not best-in-class behavior and not zero. v1.0
    let an undefined post-loss ratio pass its gate, which is the
    read-NULL-as-false bug the repo invariant names. v1.2 excludes the
    wallet-date from scoring and logs it, so it can neither be funded on a
    dimension nobody measured nor be silently ranked worst."""
    eligible, unscorable = [], []
    for w in wallets:
        m = metrics_cache[(w.address, t)]
        if not passes_floor(m):
            continue
        missing = [name for name, key in SCORE_DIMS if m.get(key) is None]
        if missing:
            unscorable.append((w, "unscorable:" + "+".join(missing)))
            continue
        eligible.append((w, m))
    if not eligible:
        return [], unscorable

    cols = {name: percentile_ranks([float(m[key]) for _, m in eligible])
            for name, key in SCORE_DIMS}
    scored = []
    for i, (w, m) in enumerate(eligible):
        pct = {name: cols[name][i] for name, _ in SCORE_DIMS}
        scored.append({
            "wallet": w,
            "metrics": m,
            "pct": pct,
            "S": sum(pct.values()) / len(SCORE_DIMS),
            # Tie break (spec §2): longer verified history wins.
            "history_days": (t - w.first_ts) / DAY_MS if w.first_ts else 0.0,
        })
    return scored, unscorable


def select_book(scored: list, quantile: float = SELECT_QUANTILE) -> list:
    """Spec §4: the top `quantile` of eligible wallets by S, largest-S first,
    with an absolute cap of SELECT_CAP so the book stays auditable. Ties on S
    are broken by longer verified history, then by address so the selection is
    deterministic and reproducible."""
    if not scored:
        return []
    ordered = sorted(scored, key=lambda s: (-s["S"], -s["history_days"],
                                            s["wallet"].address))
    k = max(1, int(round(len(ordered) * quantile)))
    return ordered[:min(k, SELECT_CAP)]


def book_weights(selected: list, equal_weight: bool = False) -> list[float]:
    """Spec §4: weights proportional to S within the selected set, subject to
    the 5 percent per-wallet cap. Excess from capped wallets is redistributed
    across the uncapped ones in proportion to S, repeated until stable.

    When the book is too small for the cap to be satisfiable (fewer than 20
    wallets), every wallet sits at the cap and the remainder is CASH, which
    earns zero — it is not levered back into the book. `equal_weight` is
    robustness variant (d)."""
    n = len(selected)
    if n == 0:
        return []
    if equal_weight:
        return [min(1.0 / n, PER_WALLET_CAP)] * n
    base = [s["S"] for s in selected]
    total = sum(base)
    if total <= 0:
        return [min(1.0 / n, PER_WALLET_CAP)] * n
    w = [b / total for b in base]
    capped = [False] * n
    for _ in range(n + 1):
        over = [i for i in range(n)
                if not capped[i] and w[i] > PER_WALLET_CAP + 1e-15]
        if not over:
            break
        for i in over:
            w[i] = PER_WALLET_CAP
            capped[i] = True
        free = [i for i in range(n) if not capped[i]]
        if not free:
            break
        remaining = 1.0 - PER_WALLET_CAP * sum(capped)
        free_total = sum(base[i] for i in free)
        if remaining <= 0 or free_total <= 0:
            for i in free:
                w[i] = 0.0
            break
        for i in free:
            w[i] = remaining * base[i] / free_total
    return w


# ── Realized-PnL risk-adjusted return (rank correlation only, spec §6) ──────

def realized_sharpe(w, t0: int, t1: int):
    """Annualised Sharpe of the wallet's daily realized-PnL returns over
    (t0, t1], anchored on equity at t0. Returns None when unmeasurable —
    never 0.

    Same disclosed limitation as the drawdown dimension: realized closedPnl
    net of fees, so funding payments and unrealized excursions are outside it.
    A day inside the window with no fills is a real zero (the wallet's history
    is verified complete over the window, so it genuinely did not trade that
    day) — unlike an uncovered day, which never reaches this function because
    the window is bounded by observed fills."""
    eq = w.avh.value_at(t0) if w.avh else None
    if eq is None or eq < EQUITY_ANCHOR_FLOOR:
        return None
    lo = bisect.bisect_right(w.fill_times, t0)
    hi = bisect.bisect_right(w.fill_times, t1)
    if hi <= lo:
        return None
    daily: dict[int, float] = defaultdict(float)
    for i in range(lo, hi):
        daily[w.fill_times[i] // DAY_MS] += w.fill_pnl_net[i]
    rets = []
    for d in range(t0 // DAY_MS, t1 // DAY_MS):
        if eq <= 0:
            return None                      # account wiped out: undefined after
        pnl = daily.get(d, 0.0)
        rets.append(pnl / eq)
        eq += pnl
    if len(rets) < 5:
        return None
    sd = statistics.stdev(rets)
    if sd == 0:
        return None
    return (sum(rets) / len(rets)) / sd * ANNUALIZE_DAILY


def _avg_ranks(xs: list[float]) -> list[float]:
    n = len(xs)
    order = sorted(range(n), key=lambda i: xs[i])
    r = [0.0] * n
    i = 0
    while i < n:
        j = i
        while j + 1 < n and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        avg = (i + j) / 2.0 + 1.0
        for k in range(i, j + 1):
            r[order[k]] = avg
        i = j + 1
    return r


def spearman(xs: list[float], ys: list[float]):
    """Spearman rank correlation (Pearson on average ranks, tie-safe)."""
    n = len(xs)
    if n < 3 or len(ys) != n:
        return None
    rx, ry = _avg_ranks(xs), _avg_ranks(ys)
    mx, my = sum(rx) / n, sum(ry) / n
    sxy = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    sxx = sum((a - mx) ** 2 for a in rx)
    syy = sum((b - my) ** 2 for b in ry)
    if sxx <= 0 or syy <= 0:
        return None
    return sxy / math.sqrt(sxx * syy)


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


# ── Book engine (spec §3 walk-forward, §4 score-weighted book) ──────────────

def run_walkforward(wallets: list[WalletData], decisions: list[int],
                    metrics_cache: dict, return_cache: dict, score_cache: dict,
                    quantile: float = SELECT_QUANTILE,
                    equal_weight: bool = False,
                    skip_contribution=None):
    """One full walk-forward pass. Returns a list of period dicts carrying the
    per-wallet rows for the CSVs.

    The walk-forward mechanics are unchanged from v1.0 and may not change
    (spec §0): at each T the wallets are scored on data at or before T only,
    the book is that T's selection, and a wallet that leaves the selection is
    dropped at that T and not retroactively. Blown-up wallets contribute their
    losses until removal or their final trade. What changed is only WHICH
    wallets the book holds and at WHAT weight.

    skip_contribution=(t_ms, address) zeroes that one wallet-period's
    contribution: robustness variant (a)."""
    periods = []
    for i, t in enumerate(decisions):
        t_next = decisions[i + 1] if i + 1 < len(decisions) else ms(
            next_month(datetime.fromtimestamp(t / 1000, tz=timezone.utc)))
        if t not in score_cache:
            score_cache[t] = score_at(wallets, t, metrics_cache)
        scored, unscorable = score_cache[t]
        selected = select_book(scored, quantile)
        weights = book_weights(selected, equal_weight)

        rows = []
        book_r = 0.0
        unmeasured_weight = 0.0
        for s, weight in zip(selected, weights):
            w = s["wallet"]
            key = (w.address, t, t_next)
            if key not in return_cache:
                return_cache[key] = w.period_return(t, t_next)
            r, source = return_cache[key]
            m = s["metrics"]
            haircut = (CAPACITY_HAIRCUT
                       if m["med_daily_notional"] > CAPACITY_MEDIAN_DAILY_NOTIONAL
                       else 0.0)
            row = {"wallet": w.address, "archetype": w.archetype,
                   "score_S": s["S"], "weight": weight, "haircut": haircut,
                   "source": source, "period_return": r, "contribution": None}
            for name, _ in SCORE_DIMS:
                row[name] = s["pct"][name]
            if r is None:
                # Missing is never zero: the weight is recorded as unmeasured
                # and reported, never coalesced into a 0 return.
                unmeasured_weight += weight
                rows.append(row)
                continue
            if skip_contribution == (t, w.address):
                row["source"] = source + "|removed_best_variant"
                row["contribution"] = 0.0
                rows.append(row)
                continue
            contrib = weight * r * (1.0 - haircut)
            row["contribution"] = contrib
            book_r += contrib
            rows.append(row)

        # Penny reconciliation: book return must equal the sum of contributions.
        resid = abs(book_r - sum(r["contribution"] or 0.0 for r in rows))
        if resid > 1e-9:
            sys.exit(f"RECONCILIATION FAILURE at {iso(t)}: residual {resid}")
        invested = sum(weights)
        periods.append({"t": t, "t_next": t_next,
                        "n_eligible": len(scored),
                        "n_unscorable": len(unscorable),
                        "n_book": len(selected),
                        "invested": invested,
                        "cash": max(0.0, 1.0 - invested),
                        "mean_S": (sum(s["S"] for s in selected) / len(selected)
                                   if selected else None),
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


# ── S3 archive cache reader (spec §7/§8) ────────────────────────────────────
# The archive is downloaded by s3_backfill.py into s3_cache/ and consumed from
# there. This module READS that cache; it never writes to Supabase, and the
# hot database receives only results (spec §7, non-negotiable).

S3_CACHE = REPO / "s3_cache"


def s3_cache_state() -> dict:
    """What the local archive cache actually holds. Reported in the coverage
    block before any result, because the depth of the walk-forward window is a
    direct function of it."""
    if not S3_CACHE.exists():
        return {"present": False, "objects": 0, "bytes": 0, "datasets": {},
                "reason": "s3_cache/ does not exist — s3_backfill.py has not run"}
    files = [p for p in S3_CACHE.rglob("*")
             if p.is_file() and p.name != "manifest.json"]
    if not files:
        return {"present": False, "objects": 0, "bytes": 0, "datasets": {},
                "reason": "s3_cache/ exists but holds no archive objects"}
    datasets: dict = defaultdict(lambda: {"objects": 0, "bytes": 0, "days": set()})
    for p in files:
        parts = p.relative_to(S3_CACHE).parts
        ds = parts[0]
        datasets[ds]["objects"] += 1
        datasets[ds]["bytes"] += p.stat().st_size
        # The cache mirrors the S3 key, whose depth varies by dataset
        # (node_fills/hourly/{ymd}/{H}.lz4 vs asset_ctxs/{ymd}.csv.lz4), so the
        # day is located by shape, not by position.
        for seg in parts[1:]:
            stem = seg.split(".")[0]
            if len(stem) == 8 and stem.isdigit():
                datasets[ds]["days"].add(stem)
                break
    out = {}
    for ds, v in datasets.items():
        days = sorted(v["days"])
        out[ds] = {"objects": v["objects"], "bytes": v["bytes"],
                   "days": len(days),
                   "first_day": days[0] if days else None,
                   "last_day": days[-1] if days else None}
    return {"present": True, "objects": len(files),
            "bytes": sum(p.stat().st_size for p in files),
            "datasets": out, "reason": ""}


def _normalise_s3_fill(rec):
    """Normalise one archive line into [(address, fill), ...], in the same
    fill shape fetch_fills() produces. Returns None when the line is not a
    recognisable fill record.

    The caller COUNTS those Nones and reports the total (`s3: WARNING n
    archive lines could not be parsed as fills`); it does not abort the run.
    That count is the point: unparsed lines are a coverage defect, and a defect
    that is surfaced can be judged, while one that is silently skipped
    manufactures gaps that read as "this wallet did not trade". Aborting a
    272 GiB read on a single malformed third-party line would be the wrong
    trade; hiding the tally would be dishonest. Neither happens.

    Both layouts below were read off real archive bytes rather than inferred.
    That distinction is not pedantry: the previous by_block branch was written
    from a guess and kept 0 fills out of 849,573 real lines, which is
    indistinguishable from a universe that never traded. An empty events list
    is NOT a parse failure — it is a measured zero."""
    # node_fills (legacy, through 2025-07-27): one two-element array per line,
    # ["0xabc...", {coin, px, sz, side, time, ...}]. Checked before the dict
    # branches because a list has no .get() and would otherwise raise.
    if isinstance(rec, list):
        if len(rec) == 2 and isinstance(rec[0], str) and isinstance(rec[1], dict):
            return [(rec[0], rec[1])]
        return None
    if not isinstance(rec, dict):
        return None
    # node_fills_by_block (primary, from 2025-07-27): one block per line,
    # {local_time, block_time, block_number, events: [[address, fill], ...]}.
    # Most blocks carry events: [] — the venue produces blocks faster than
    # trades arrive — so the empty case is the common case, not a defect.
    if isinstance(rec.get("events"), list):
        pairs = []
        for item in rec["events"]:
            if (isinstance(item, list) and len(item) == 2
                    and isinstance(item[0], str) and isinstance(item[1], dict)):
                pairs.append((item[0], item[1]))
            else:
                return None
        return pairs
    if "raw" in rec and isinstance(rec.get("raw"), dict):
        data = rec["raw"].get("data", rec["raw"])
        if isinstance(data, dict) and "fills" in data:
            return [(data.get("user") or data.get("address"), f)
                    for f in data["fills"]]
        rec = data if isinstance(data, dict) else rec
    user = rec.get("user") or rec.get("address")
    if user and all(k in rec for k in ("coin", "px", "sz", "side", "time")):
        return [(user, rec)]
    return None


# The per-fill tape lives in two datasets that are contiguous in time, not
# alternatives: node_fills is the legacy format and stops at 2025-07-27;
# node_fills_by_block picks up the same day and runs to the present. Both are
# read, and the seam day is de-duplicated below.
S3_FILL_DATASETS = ("node_fills", "node_fills_by_block")


def load_s3_fills(addresses: set, start_ms: int, end_ms: int) -> dict:
    """Read the archive tape from the local cache into {address: [fills]}.

    Objects are STREAM-decompressed one line at a time. The whole-file
    lz4.frame.decompress(read_bytes()) form this replaced held both the
    compressed object and its full expansion in memory at once; at ~0.6 GiB of
    compressed tape per archive day that is not survivable, and it is the
    reason the cache must be consumed incrementally rather than loaded.

    Only the requested addresses are retained; the archive is a full-venue tape
    and holding all of it is neither necessary nor possible. Returns {} when
    the cache holds no fills dataset — the caller reports that as absent
    coverage, never as a wallet that did not trade."""
    roots = [S3_CACHE / d for d in S3_FILL_DATASETS if (S3_CACHE / d).exists()]
    if not roots:
        return {}
    try:
        import lz4.frame
    except ImportError:
        sys.exit("s3_cache/ holds archive objects but python-lz4 is missing: "
                 "pip3 install lz4")
    out: dict = defaultdict(list)
    objects = sorted(p for r in roots for p in r.rglob("*.lz4") if p.is_file())
    # Identity of a fill across the format seam. tid is the venue's trade id and
    # is stable between the two datasets; the tuple is the fallback when absent.
    seen: set = set()
    bad = 0
    # Per-dataset accounting. A dataset that is ON DISK but yields nothing is
    # the failure mode this tally exists to make loud: node_fills_by_block once
    # kept 0 fills from 849,573 lines because its record shape had been guessed,
    # and the only reason anyone noticed was that someone measured it by hand.
    # Zero kept is indistinguishable from a universe that never traded unless
    # the run says which of the two it is.
    ds_stat: dict = defaultdict(lambda: {"objects": 0, "lines": 0, "unparsed": 0,
                                         "pairs": 0, "off_universe": 0,
                                         "off_window": 0, "dupes": 0, "kept": 0})
    for n, path in enumerate(objects, 1):
        ds = path.relative_to(S3_CACHE).parts[0]
        st = ds_stat[ds]
        st["objects"] += 1
        try:
            with lz4.frame.open(path, "rb") as fh:
                for raw in fh:                     # one line at a time
                    line = raw.strip()
                    if not line:
                        continue
                    st["lines"] += 1
                    try:
                        rec = json.loads(line)
                    except json.JSONDecodeError:
                        bad += 1
                        st["unparsed"] += 1
                        continue
                    pairs = _normalise_s3_fill(rec)
                    if pairs is None:
                        bad += 1
                        st["unparsed"] += 1
                        continue
                    st["pairs"] += len(pairs)
                    for user, f in pairs:
                        if not user:
                            continue
                        u = user.lower()
                        if u not in addresses:
                            st["off_universe"] += 1
                            continue
                        t = int(f["time"])
                        if not (start_ms <= t <= end_ms):
                            st["off_window"] += 1
                            continue
                        tid = f.get("tid")
                        key = ((u, "tid", tid) if tid is not None else
                               (u, t, f["coin"], str(f["px"]), str(f["sz"]),
                                f["side"]))
                        if key in seen:
                            st["dupes"] += 1
                            continue           # seam overlap, not a second fill
                        seen.add(key)
                        out[u].append({
                            "time": t, "coin": f["coin"], "px": f["px"],
                            "sz": f["sz"], "side": f["side"],
                            "startPosition": f.get("startPosition"),
                            "closedPnl": f.get("closedPnl"),
                            "fee": f.get("fee"),
                            "liq": bool(f.get("liquidation")
                                        or f.get("liquidationMarkPx")),
                        })
                        st["kept"] += 1
        except OSError as exc:
            sys.exit(f"Corrupt archive object {path}: {type(exc).__name__}: "
                     f"{exc}. Re-run s3_backfill.py rather than skipping it.")
        if n % 200 == 0 or n == len(objects):
            print(f"  s3: {n}/{len(objects)} objects, "
                  f"{sum(len(v) for v in out.values()):,} fills kept", flush=True)
    if bad:
        # Reported, never hidden: unparsed lines are a coverage defect.
        print(f"  s3: WARNING {bad:,} archive lines could not be parsed as fills")
    # EVERY dataset present on disk reports, including the ones that yielded
    # nothing. The old form printed only datasets with a non-zero count, so a
    # dataset contributing zero was silent — the one case that most needs
    # saying out loud.
    for ds in S3_FILL_DATASETS:
        if ds not in ds_stat:
            continue
        st = ds_stat[ds]
        print(f"  s3: {ds:<20} {st['kept']:>10,} kept  "
              f"({st['objects']:,} objects, {st['lines']:,} lines, "
              f"{st['pairs']:,} fills seen)")
        if st["lines"] and not st["kept"]:
            # Name the cause rather than leaving a bare zero. Each branch is a
            # different claim about the world and only one of them is "these
            # wallets did not trade".
            if st["unparsed"] == st["lines"]:
                why = ("EVERY line failed to parse — the record shape does not "
                       "match what _normalise_s3_fill expects. This is a code "
                       "defect, NOT an absence of trading.")
            elif not st["pairs"]:
                why = ("lines parsed but yielded no fills at all — likely an "
                       "envelope whose fills live under a key this parser does "
                       "not read. A code defect, NOT an absence of trading.")
            elif st["off_universe"] and not (st["off_window"] or st["dupes"]):
                why = (f"{st['off_universe']:,} fills parsed, all outside the "
                       "requested wallet universe. Genuine, if the universe is "
                       "the one you meant.")
            elif st["off_window"] and not st["off_universe"]:
                why = (f"{st['off_window']:,} fills parsed, all outside the "
                       "requested time window. Genuine, if the window is the "
                       "one you meant.")
            else:
                why = (f"parsed {st['pairs']:,} fills: "
                       f"{st['off_universe']:,} off-universe, "
                       f"{st['off_window']:,} off-window, "
                       f"{st['dupes']:,} seam duplicates.")
            print(f"  s3: *** {ds} IS PRESENT BUT CONTRIBUTED NOTHING ***")
            print(f"  s3:     {why}")
    for v in out.values():
        v.sort(key=lambda f: f["time"])
    return dict(out)


def merge_fills(api_fills: list, s3_fills: list) -> list:
    """Union of the API tape and the archive tape, de-duplicated on the fields
    that identify a fill. The archive extends history behind the /info API's
    retention; where they overlap they must agree, and duplicates are dropped
    rather than double-counted."""
    if not s3_fills:
        return api_fills
    seen = {(f["time"], f["coin"], str(f["px"]), str(f["sz"]), f["side"])
            for f in api_fills}
    merged = list(api_fills)
    for f in s3_fills:
        k = (f["time"], f["coin"], str(f["px"]), str(f["sz"]), f["side"])
        if k not in seen:
            seen.add(k)
            merged.append(f)
    merged.sort(key=lambda f: f["time"])
    return merged


# ── Main ────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="MERIT P0 graduated-book backtest v1.2")
    ap.add_argument("--coverage-only", action="store_true",
                    help="print the honest data coverage report and stop")
    ap.add_argument("--confirm-low-power", action="store_true",
                    help="operator confirmation to proceed when the coverage "
                         "gate finds fewer than %d qualifying decision dates "
                         "(the verdict then carries the LOW-POWER flag)"
                         % MIN_QUALIFYING_DATES)
    ap.add_argument("--universe", choices=("all", "classified", "directional"),
                    default="all",
                    help="wallet universe. v1.2 §0 change 2 requires 'all': "
                         "S scores observable behavior, not our labels. The "
                         "narrower scopes are diagnostics and are labelled as "
                         "such in every output.")
    ap.add_argument("--streaming", action="store_true",
                    help="read the archive through s3_stream (spill + lazy "
                         "merge) instead of load_s3_fills. Required at "
                         "full-universe scale: the old loader needs 769 GiB.")
    ap.add_argument("--spill-dir", default=None,
                    help="where the streaming pass writes per-wallet spills "
                         "(default: <repo>/s3_spill)")
    ap.add_argument("--rehearsal", action="store_true",
                    help="label every output REHEARSAL and write to a separate "
                         "directory. For a run that exercises the pipeline on "
                         "data that cannot satisfy the coverage gate.")
    ap.add_argument("--limit", type=int, default=0,
                    help="DEV ONLY: cap the wallet universe for a smoke run; "
                         "results produced with --limit are not the test")
    args = ap.parse_args()

    global REHEARSAL_MODE, RESULTS
    if args.rehearsal:
        REHEARSAL_MODE = True
        RESULTS = REPO / "backtest_results" / "graduation_REHEARSAL"
        RESULTS.mkdir(parents=True, exist_ok=True)

    t_start = time.time()
    now_ms = int(time.time() * 1000)
    print("=" * 74)
    if REHEARSAL_MODE:
        print("REHEARSAL — NOT A BINDING RUN, NOT A VERDICT")
        print("=" * 74)
    print("MERIT P0 — GRADUATED-BOOK BACKTEST (docs/merit_p0_backtest_spec.md v1.2)")
    print("=" * 74)
    if REHEARSAL_MODE:
        print("This run exercises the full v1.2 pipeline on an archive that")
        print("cannot satisfy the spec §7 coverage gate. Every output is")
        print("labelled REHEARSAL and written to backtest_results/")
        print("graduation_REHEARSAL/. Nothing here publishes to the Ledger, and")
        print("no result in it may be cited as a verdict on the hypothesis.")
        print("=" * 74)
    print("Hypothesis (pre-registered): wallets ranked highly on a continuous")
    print("process score S beat passive HLP exposure risk-adjusted, with lower")
    print("drawdown, as a top-quintile score-weighted book. No returns, PnL,")
    print("Sharpe or win-rate term enters S. That absence is the experiment.")

    # ── S3 archive cache (spec §7): reported before anything is computed ────
    s3 = s3_cache_state()
    print("\n" + "-" * 74)
    print("S3 ARCHIVE CACHE (spec §7 — local cache only, never loaded into Supabase)")
    print("-" * 74)
    if s3["present"]:
        print(f"  present: {s3['objects']:,} objects, {s3['bytes'] / 1024**3:.2f} GiB")
        for ds, v in sorted(s3["datasets"].items()):
            print(f"    {ds:<16} {v['objects']:>7,} objects  {v['days']:>5} days  "
                  f"{v['first_day']} → {v['last_day']}")
    else:
        print(f"  ABSENT — {s3['reason']}")
        print("  The archive backfill has not been run, so the walk-forward window")
        print("  is bounded by the /info API's retention rather than by the")
        print("  archive's depth. This is reported, not worked around: spec §7")
        print("  requires the S3 backfill for a binding v1.2 verdict.")

    universe = fetch_universe(args.universe)
    if args.limit:
        universe = universe[:args.limit]
        print(f"\n*** DEV SMOKE RUN: universe capped at {args.limit} — NOT the test ***")
    scope_note = {
        "all": "the full tracked wallet universe (spec v1.2 §0 change 2)",
        "classified": "classified wallets only — NARROWER than v1.2 requires",
        "directional": "classified directional wallets only — NARROWER than v1.2 requires",
    }[args.universe]
    print(f"\nUniverse: {len(universe)} wallets — {scope_note}.")

    # ── Fetch + preprocess ──────────────────────────────────────────────────
    addresses = {row["address"].lower() for row in universe}
    s3_fills_by_addr = {}
    spill_dir = None
    if s3["present"] and args.streaming:
        # Streaming path (s3_stream). Equivalence to the loader below is
        # demonstrated by test_equivalence_streaming.py, whose artifact ships
        # with the run; StreamingWalletData inherits metrics_at() unchanged, so
        # only the attributes can differ and the harness compares those.
        import s3_stream
        spill_dir = Path(args.spill_dir) if args.spill_dir else (REPO / "s3_spill")
        print(f"\nStreaming the archive into per-wallet spills at {spill_dir} ...")
        st = s3_stream.spill_archive(addresses, spill_dir, 0, now_ms)
        print(f"  spilled {st['kept']:,} in-universe fills from "
              f"{st['objects']:,} objects "
              f"({st['seam_dupes']:,} seam duplicates dropped)")
    elif s3["present"]:
        print("\nReading the archive cache with the in-memory loader...")
        print("  NOTE: this retains the whole filtered tape. Measured at "
              "full-universe")
        print("  scale that is 769 GiB — use --streaming for anything "
              "beyond a subset.")
        s3_fills_by_addr = load_s3_fills(addresses, 0, now_ms)
        print(f"  archive supplied fills for {len(s3_fills_by_addr):,} of "
              f"{len(addresses):,} universe wallets")

    wallets: list[WalletData] = []
    fetch_log: list[str] = []
    for i, row in enumerate(universe):
        addr = row["address"]
        fills, complete = fetch_fills(addr)
        portfolio = fetch_portfolio(addr)
        if spill_dir is not None:
            import s3_stream
            # Mirror the loader's rule exactly: an API pull that hit the page
            # cap is complete again once the archive covers behind it, but only
            # if this wallet actually HAS archive data. Passing True
            # unconditionally would silently readmit wallets whose history is
            # genuinely truncated.
            has_arch = any(
                s3_stream.spill_path(spill_dir, ds, addr.lower()).exists()
                for ds in S3_FILL_DATASETS)
            wd = s3_stream.build_streaming_wallet(
                addr.lower(), row.get("archetype") or "unclassified",
                spill_dir, fills, complete or has_arch, portfolio)
            if wd.n_fills == 0:
                fetch_log.append(
                    f"{addr} no perp fills in archive or API — excluded")
                continue
            wallets.append(wd)
            if (i + 1) % 25 == 0:
                print(f"  built {i + 1}/{len(universe)} wallets "
                      f"({time.time() - t_start:.0f}s elapsed)", flush=True)
            continue
        arch = s3_fills_by_addr.get(addr.lower(), [])
        if arch:
            fills = merge_fills(fills, arch)
            # The archive reaches behind the API's retention, so a wallet whose
            # API pull hit the page cap is complete again once merged.
            complete = True
        if not fills:
            fetch_log.append(f"{addr} no fills retrievable — excluded from universe")
            continue
        wd = WalletData(addr, row.get("archetype") or "unclassified",
                        fills, complete, portfolio)
        if wd.n_fills == 0:
            fetch_log.append(f"{addr} no perp fills (spot-only wallet) — excluded")
            continue
        wallets.append(wd)
        if (i + 1) % 25 == 0:
            print(f"  fetched {i + 1}/{len(universe)} wallets "
                  f"({time.time() - t_start:.0f}s elapsed)", flush=True)
    print(f"Fetched {len(wallets)} wallets with fills "
          f"({len(universe) - len(wallets)} with none, logged).")
    if not wallets:
        sys.exit("No wallet in the universe has retrievable perp fills. Stopping.")

    # ── Decision calendar & per-(wallet, T) metrics ─────────────────────────
    earliest = min(w.first_ts for w in wallets)
    decisions_all = month_boundaries(earliest, now_ms)
    metrics_cache: dict = {}
    for w in wallets:
        for t in decisions_all:
            metrics_cache[(w.address, t)] = w.metrics_at(t)
    score_cache: dict = {}
    for t in decisions_all:
        score_cache[t] = score_at(wallets, t, metrics_cache)

    # ── Honest data coverage report (spec §7) ───────────────────────────────
    print("\n" + "=" * 74)
    print("HONEST DATA COVERAGE REPORT (printed before any result)")
    print("=" * 74)
    print("Eligibility floor per decision date: ≥60 resolved round trips and")
    print("≥30 active days in the trailing 60d window, complete verified history")
    print("(startPosition validation), equity anchor servable.")
    print(f"A date QUALIFIES for the headline when it has ≥"
          f"{MIN_ELIGIBLE_FOR_QUALIFYING} eligible wallets (spec §4 breadth")
    print("floor). Under-powered dates are scored and reported, not silently")
    print("dropped, and never padded.")
    print(f"\n{'decision':>10}  {'active':>6}  {'excl':>5}  {'unscor':>6}  "
          f"{'eligible':>8}  {'qual':>4}  {'book':>4}  {'S p50':>6}  "
          f"{'S p90':>6}  {'S max':>6}")
    coverage_rows = []
    for t in decisions_all:
        scored, unscorable = score_cache[t]
        active = excluded = 0
        for w in wallets:
            m = metrics_cache[(w.address, t)]
            if m["excluded"] == "no_fills_in_window":
                continue
            active += 1
            if m["excluded"] is not None:
                excluded += 1
        n_elig = len(scored)
        qualifies = n_elig >= MIN_ELIGIBLE_FOR_QUALIFYING
        ss = sorted(s["S"] for s in scored)
        p50 = statistics.median(ss) if ss else None
        p90 = ss[min(len(ss) - 1, int(0.9 * len(ss)))] if ss else None
        smax = ss[-1] if ss else None
        n_book = len(select_book(scored))
        coverage_rows.append({
            "decision_date": iso(t), "t": t, "active": active,
            "excluded": excluded, "unscorable": len(unscorable),
            "eligible": n_elig, "qualifying": qualifies, "n_book": n_book,
            "S_p50": p50, "S_p90": p90, "S_max": smax})
        print(f"{iso(t):>10}  {active:>6}  {excluded:>5}  {len(unscorable):>6}  "
              f"{n_elig:>8}  {'yes' if qualifies else 'no':>4}  {n_book:>4}  "
              f"{fmtf(p50):>6}  {fmtf(p90):>6}  {fmtf(smax):>6}")

    qualifying = [r for r in coverage_rows if r["qualifying"]]
    n_qual = len(qualifying)
    under_powered = [r["decision_date"] for r in coverage_rows
                     if not r["qualifying"] and r["eligible"] > 0]

    # Headline uses the longest CONTIGUOUS run of qualifying dates: spanning a
    # non-qualifying gap would join two windows that were never one window.
    best_start = best_len = cur_start = cur_len = 0
    for i, row in enumerate(coverage_rows):
        if row["qualifying"]:
            if cur_len == 0:
                cur_start = i
            cur_len += 1
            if cur_len > best_len:
                best_len, best_start = cur_len, cur_start
        else:
            cur_len = 0
    run_rows = coverage_rows[best_start:best_start + best_len]

    print(f"\nQualifying decision dates (≥{MIN_ELIGIBLE_FOR_QUALIFYING} eligible): "
          f"{n_qual} of {len(coverage_rows)}")
    print(f"Longest CONTIGUOUS qualifying run: {best_len} dates"
          + (f" ({run_rows[0]['decision_date']} → {run_rows[-1]['decision_date']})"
             if run_rows else ""))
    if under_powered:
        print(f"Under-powered dates (eligible ≥1 but <"
              f"{MIN_ELIGIBLE_FOR_QUALIFYING}): {len(under_powered)} — "
              f"{', '.join(under_powered)}")
    mean_elig = (sum(r["eligible"] for r in coverage_rows) / len(coverage_rows)
                 if coverage_rows else 0.0)
    print(f"Mean eligible wallets across all {len(coverage_rows)} dates: {mean_elig:.1f}")

    write_coverage_csv(coverage_rows, {r["t"] for r in run_rows})

    if args.coverage_only:
        print("\n--coverage-only: stopping here as requested.")
        return 0

    # ── Coverage gate (spec §7): stop rather than degrade ───────────────────
    low_power = best_len < MIN_QUALIFYING_DATES
    if low_power and not args.confirm_low_power:
        print("\n" + "!" * 74)
        print(f"STOP — COVERAGE GATE (spec §7).")
        print(f"The data supports {best_len} contiguous qualifying decision "
              f"date(s); the spec requires at least {MIN_QUALIFYING_DATES}.")
        if not s3["present"]:
            print("The S3 archive cache is ABSENT, so this window is bounded by")
            print("the /info API's retention and by the universe actually")
            print("fetched — not by the archive depth v1.2 §7 requires.")
        print("Per spec §7 the run stops and reports rather than degrading.")
        print("No verdict has been produced and none should be inferred.")
        print("Coverage CSV written; re-run with --confirm-low-power only if you")
        print("intend a diagnostic that is explicitly NOT the binding verdict.")
        print("!" * 74)
        return 3
    if not run_rows:
        print("\nNo qualifying decision date exists. Nothing to run. Stopping.")
        return 3

    decisions = [r["t"] for r in run_rows]
    window_months = len(decisions)
    dropped = [r["decision_date"] for r in coverage_rows
               if r["t"] not in set(decisions)]

    # ── Benchmark + factor series ───────────────────────────────────────────
    hlp = fetch_hlp_series()
    hlp_pnl = SampledSeries(hlp["pnl"])
    hlp_avh = SampledSeries(hlp["avh"])
    candles = CandleStore()

    boundaries = decisions + [ms(next_month(
        datetime.fromtimestamp(decisions[-1] / 1000, tz=timezone.utc)))]
    hlp_returns, btc_returns = [], []
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
    headline = run_walkforward(wallets, decisions, metrics_cache, return_cache,
                               score_cache)
    book_returns = [p["book_return"] for p in headline]
    book_counts = [p["n_book"] for p in headline]
    avg_breadth = sum(book_counts) / len(book_counts)

    sr_book = sharpe(book_returns)
    sr_hlp = sharpe(hlp_returns)
    dd_book = max_drawdown(book_returns)
    dd_hlp = max_drawdown(hlp_returns)
    headline_adv = (sr_book or 0.0) - (sr_hlp or 0.0)
    headline_sign = headline_adv > 0
    trial_srs = [sr_book] if sr_book is not None else []

    # ── Robustness battery (spec §6.4) ──────────────────────────────────────
    robustness_rows = []

    # (a) removal of the single best wallet-period.
    best_contrib, best_key = 0.0, None
    for p in headline:
        for r in p["rows"]:
            if r["contribution"] is not None and r["contribution"] > best_contrib:
                best_contrib, best_key = r["contribution"], (p["t"], r["wallet"])
    if best_key is not None:
        periods_a = run_walkforward(wallets, decisions, metrics_cache,
                                    return_cache, score_cache,
                                    skip_contribution=best_key)
        sr_a = sharpe([p["book_return"] for p in periods_a])
        adv_a = (sr_a or 0.0) - (sr_hlp or 0.0)
        surv_a = (adv_a > 0) == headline_sign
        label_a = (f"(a) remove best wallet-period "
                   f"({best_key[1][:10]}…@{iso(best_key[0])}, "
                   f"+{best_contrib * 100:.2f}%)")
    else:
        sr_a, adv_a, surv_a = sr_book, headline_adv, True
        label_a = "(a) remove best wallet-period (no positive contribution found)"
    robustness_rows.append({"variant": label_a, "book_sharpe": sr_a,
                            "hlp_sharpe": sr_hlp, "advantage": adv_a,
                            "avg_book": avg_breadth, "sign_survives": surv_a})

    # (b) first-half vs second-half split.
    half = len(book_returns) // 2
    halves = []
    for tag, sl in (("first half", slice(0, half)), ("second half", slice(half, None))):
        sr_h = sharpe(book_returns[sl])
        sr_hlp_h = sharpe(hlp_returns[sl])
        adv_h = (sr_h or 0.0) - (sr_hlp_h or 0.0)
        surv = (adv_h > 0) == headline_sign
        halves.append(surv)
        robustness_rows.append({
            "variant": f"(b) {tag} ({len(book_returns[sl])} months)",
            "book_sharpe": sr_h, "hlp_sharpe": sr_hlp_h, "advantage": adv_h,
            "avg_book": None, "sign_survives": surv})

    # (c) selection at top 10% and top 30% instead of 20%.
    quantile_rows = []
    for q in (0.10, 0.30):
        periods_q = run_walkforward(wallets, decisions, metrics_cache,
                                    return_cache, score_cache, quantile=q)
        rets = [p["book_return"] for p in periods_q]
        sr_q = sharpe(rets)
        adv_q = (sr_q or 0.0) - (sr_hlp or 0.0)
        row = {"variant": f"(c) selection at top {int(q * 100)}%",
               "book_sharpe": sr_q, "hlp_sharpe": sr_hlp, "advantage": adv_q,
               "avg_book": sum(p["n_book"] for p in periods_q) / len(periods_q),
               "sign_survives": (adv_q > 0) == headline_sign}
        quantile_rows.append(row)
        robustness_rows.append(row)
        if sr_q is not None:
            trial_srs.append(sr_q)

    # (d) equal-weight instead of S-weighted allocation.
    periods_d = run_walkforward(wallets, decisions, metrics_cache, return_cache,
                                score_cache, equal_weight=True)
    sr_d = sharpe([p["book_return"] for p in periods_d])
    adv_d = (sr_d or 0.0) - (sr_hlp or 0.0)
    surv_d = (adv_d > 0) == headline_sign
    robustness_rows.append({"variant": "(d) equal-weight instead of S-weighted",
                            "book_sharpe": sr_d, "hlp_sharpe": sr_hlp,
                            "advantage": adv_d,
                            "avg_book": sum(p["n_book"] for p in periods_d) / len(periods_d),
                            "sign_survives": surv_d})
    if sr_d is not None:
        trial_srs.append(sr_d)

    k4_pass = (surv_a and all(halves)
               and all(r["sign_survives"] for r in quantile_rows) and surv_d)

    # ── Deflated Sharpe (kill criterion 1) ──────────────────────────────────
    n_configs = len(trial_srs)
    emax = expected_max_sharpe(trial_srs)
    sr_deflated = (sr_book - emax) if sr_book is not None else None

    # ── Kill criteria (spec §6) ─────────────────────────────────────────────
    k1 = (sr_deflated is not None and sr_hlp is not None and sr_deflated > sr_hlp)
    k2 = dd_book < dd_hlp
    k3 = (avg_breadth >= MIN_BOOK_BREADTH and window_months >= MIN_QUALIFYING_DATES)
    if k1 and k2 and k4_pass:
        verdict = "PASS" if k3 else "INCONCLUSIVE"
    else:
        verdict = "FAIL"

    # BTC alpha (reported, not gating).
    pairs = [(b, x) for b, x in zip(book_returns, btc_returns) if x is not None]
    alpha, beta = ols_alpha_beta([p[0] for p in pairs], [p[1] for p in pairs])

    # ── Predictive validity: S vs forward performance, with the foil ────────
    # Spec §6: the rank correlation between S at T and forward 90-day
    # risk-adjusted return, and the SAME correlation for a trailing-Sharpe
    # ranking as the published foil. Pooled across all qualifying decision
    # dates over eligible wallets, and also per date.
    pooled_S, pooled_fwd, pooled_trail = [], [], []
    percorr_rows = []
    for t in decisions:
        scored, _ = score_cache[t]
        xs_s, xs_tr, ys = [], [], []
        for s in scored:
            w = s["wallet"]
            fwd = realized_sharpe(w, t, t + FORWARD_FUNDED_DAYS * DAY_MS)
            trail = realized_sharpe(w, t - EVAL_WINDOW_DAYS * DAY_MS, t)
            if fwd is None or trail is None:
                continue          # unmeasurable, excluded — never zero-filled
            xs_s.append(s["S"])
            xs_tr.append(trail)
            ys.append(fwd)
        if len(ys) >= 3:
            percorr_rows.append({
                "decision_date": iso(t), "n": len(ys),
                "rho_S": spearman(xs_s, ys),
                "rho_trailing_sharpe": spearman(xs_tr, ys)})
        pooled_S.extend(xs_s)
        pooled_trail.extend(xs_tr)
        pooled_fwd.extend(ys)
    rho_S = spearman(pooled_S, pooled_fwd)
    rho_foil = spearman(pooled_trail, pooled_fwd)
    n_pool = len(pooled_fwd)

    # ── Outputs ─────────────────────────────────────────────────────────────
    write_outputs(headline, robustness_rows, coverage_rows, decisions, boundaries,
                  book_returns, hlp_returns, btc_returns, metrics_cache, wallets,
                  return_cache, fetch_log, score_cache, percorr_rows)

    max_resid = max(p["reconciliation_residual"] for p in headline)
    unmeasured = [(iso(p["t"]), p["unmeasured_weight"]) for p in headline
                  if p["unmeasured_weight"] > 0]

    verdict_lines = []
    add = verdict_lines.append
    add("=" * 74)
    add("MERIT P0 VERDICT — pre-registered kill criteria (spec v1.2 §6), headline")
    add("=" * 74)
    add(f"Walk-forward window: {iso(decisions[0])} → {iso(boundaries[-1])} "
        f"({window_months} monthly periods, all qualifying)")
    lp_text = (f"YES — only {window_months} contiguous qualifying decision dates "
               f"(< {MIN_QUALIFYING_DATES}); run proceeded under "
               f"--confirm-low-power and is NOT a binding verdict"
               if low_power else "no")
    add(f"LOW-POWER flag: {lp_text}")
    add(f"Universe: {args.universe} ({len(wallets)} wallets with perp fills)")
    add(f"S3 archive cache: {'present' if s3['present'] else 'ABSENT — ' + s3['reason']}")
    add(f"Book monthly returns: n={len(book_returns)}; HLP identical calendar windows.")
    add("")
    add("K1 deflated Sharpe > HLP Sharpe:")
    add(f"    book Sharpe (ann.)      = {fmtf(sr_book)}")
    add(f"    deflation haircut       = {emax:.4f}  (E[max SR] across "
        f"{n_configs} examined configurations, Bailey–López de Prado term)")
    add(f"    book deflated Sharpe    = {fmtf(sr_deflated)}")
    add(f"    HLP Sharpe (ann.)       = {fmtf(sr_hlp)}")
    add(f"    → {'PASS' if k1 else 'FAIL'}")
    add("K2 book max drawdown < HLP max drawdown:")
    add(f"    book maxDD = {dd_book * 100:.2f}%   HLP maxDD = {dd_hlp * 100:.2f}%")
    add(f"    → {'PASS' if k2 else 'FAIL'}")
    add(f"K3 breadth ≥ {MIN_BOOK_BREADTH:.0f} wallets in book AND ≥"
        f"{MIN_QUALIFYING_DATES} qualifying decision dates:")
    add(f"    average wallets in book = {avg_breadth:.1f} "
        f"(min {min(book_counts)}, max {max(book_counts)})")
    add(f"    qualifying decision dates = {window_months}")
    add(f"    → {'PASS' if k3 else 'FAIL → verdict capped at INCONCLUSIVE, never PASS'}")
    add("K4 robustness — sign of Sharpe advantage survives:")
    add(f"    (a) remove best wallet-period: {'survives' if surv_a else 'FLIPS'}")
    add(f"    (b) half-split: first {'survives' if halves[0] else 'FLIPS'}, "
        f"second {'survives' if halves[1] else 'FLIPS'}")
    add(f"    (c) top 10%: {'survives' if quantile_rows[0]['sign_survives'] else 'FLIPS'}"
        f", top 30%: {'survives' if quantile_rows[1]['sign_survives'] else 'FLIPS'}")
    add(f"    (d) equal-weight: {'survives' if surv_d else 'FLIPS'}")
    add(f"    → {'PASS' if k4_pass else 'FAIL (a flip on any variant is curve fitting per spec §6.4)'}")
    add("")
    add(f"VERDICT: {verdict}{' [LOW-POWER]' if low_power else ''}")
    add("")
    add("Reported, not gating — predictive validity (spec §6):")
    add(f"    rank corr(S at T, forward 90d risk-adj return) = {fmtf(rho_S)}  "
        f"(n={n_pool} wallet-dates)")
    add(f"    rank corr(trailing Sharpe, same forward measure) = {fmtf(rho_foil)}  "
        f"[the published foil]")
    add(f"Reported, not gating — book vs BTC factor: "
        f"alpha={fmtf(alpha, pct=True)}/month, beta={fmtf(beta)}")
    add(f"Penny reconciliation: max period residual {max_resid:.2e} (must be <1e-9).")
    if unmeasured:
        add(f"Unmeasured book weight (excluded, reported, never zero-filled): "
            f"{', '.join(f'{d}:{w * 100:.1f}%' for d, w in unmeasured)}")
    add("")
    add("data_coverage: window served as above. Decision dates examined: "
        f"{len(coverage_rows)}; qualifying: {n_qual}; contiguous qualifying run "
        f"served: {window_months}.")
    if dropped:
        add(f"Dropped decision dates (outside the contiguous qualifying run): "
            f"{len(dropped)} — {', '.join(dropped)}")
    if under_powered:
        add(f"Under-powered dates (<{MIN_ELIGIBLE_FOR_QUALIFYING} eligible), "
            f"scored but excluded from the headline: {len(under_powered)}")
    add("Scope: the perp account only — spot pairs are excluded by construction")
    add("(spot balances move by transfer, so fills-based completeness validation")
    add("is impossible for them). Granularity mix: portfolio series are ~11-day")
    add("API samples interpolated at month boundaries, with fills-reconstructed")
    add("realized-pnl fallback; the S dimensions use fills-reconstructed realized")
    add("equity (funding payments and unrealized excursions not captured —")
    add("disclosed limitation); HLP from the public vault allTime history")
    add("(~12.5-day sampling); both sides gross of fund fees, identical")
    add("accounting. Source mix and excluded pairs: see contributions.csv and")
    add("exclusions.csv. Wallet-dates whose window left a dimension undefined")
    add("were excluded from scoring and counted in coverage.csv (unscorable),")
    add("never ranked as if the missing dimension were perfect.")

    block = "\n".join(verdict_lines)
    print("\n" + block)
    (R("verdict.txt")).write_text(block + "\n")
    print(f"\nCSVs written to {RESULTS}/. Runtime {time.time() - t_start:.0f}s.")
    return 0


def write_coverage_csv(coverage_rows, in_window: set):
    with open(R("coverage.csv"), "w", newline="") as fh:
        fields = ["decision_date", "active", "excluded", "unscorable", "eligible",
                  "qualifying", "n_book", "S_p50", "S_p90", "S_max",
                  "in_walkforward_window"]
        wcsv = csv.DictWriter(fh, fieldnames=fields)
        wcsv.writeheader()
        for r in coverage_rows:
            wcsv.writerow({
                "decision_date": r["decision_date"], "active": r["active"],
                "excluded": r["excluded"], "unscorable": r["unscorable"],
                "eligible": r["eligible"], "qualifying": r["qualifying"],
                "n_book": r["n_book"],
                "S_p50": f"{r['S_p50']:.6f}" if r["S_p50"] is not None else "",
                "S_p90": f"{r['S_p90']:.6f}" if r["S_p90"] is not None else "",
                "S_max": f"{r['S_max']:.6f}" if r["S_max"] is not None else "",
                "in_walkforward_window": r["t"] in in_window})


def fmtf(v, pct=False):
    if v is None:
        return "—"
    return f"{v*100:.3f}%" if pct else f"{v:.4f}"


def write_outputs(headline, robustness_rows, coverage_rows, decisions, boundaries,
                  book_returns, hlp_returns, btc_returns, metrics_cache, wallets,
                  return_cache, fetch_log, score_cache, percorr_rows):
    # Per-period book CSVs (the receipt: one CSV per decision period).
    for stale in list(RESULTS.glob("book_*.csv")) + \
                 list(RESULTS.glob("REHEARSAL_book_*.csv")):
        stale.unlink()
    for p in headline:
        name = datetime.fromtimestamp(p["t"] / 1000, tz=timezone.utc).strftime("%Y-%m")
        with open(R(f"book_{name}.csv"), "w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=(
                ["wallet", "archetype", "score_S"]
                + [name for name, _ in SCORE_DIMS]
                + ["weight", "haircut", "source", "period_return",
                   "contribution"]))
            w.writeheader()
            for r in p["rows"]:
                w.writerow(r)

    # Equity curves + period summary.
    with open(R("book_periods.csv"), "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["period_start", "period_end", "n_eligible", "n_book",
                    "mean_S_in_book", "invested_weight",
                    "cash_weight", "unmeasured_weight", "book_return", "hlp_return",
                    "btc_return", "book_equity", "hlp_equity"])
        eq_b = eq_h = 1.0
        for p, rb, rh, rx in zip(headline, book_returns, hlp_returns, btc_returns):
            eq_b *= (1 + rb)
            eq_h *= (1 + rh)
            w.writerow([iso(p["t"]), iso(p["t_next"]), p["n_eligible"], p["n_book"],
                        f"{p['mean_S']:.6f}" if p["mean_S"] is not None else "",
                        f"{p['invested']:.6f}", f"{p['cash']:.6f}",
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
    with open(R("contributions.csv"), "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["wallet", "archetype", "periods_in_book", "total_contribution",
                    "capacity_haircut_periods", "return_sources"])
        for addr, a in sorted(agg.items(), key=lambda kv: -kv[1]["total_contribution"]):
            w.writerow([addr, a["archetype"], a["periods"],
                        f"{a['total_contribution']:.8f}", a["haircut_periods"],
                        "|".join(sorted(a["sources"]))])

    # Robustness battery table.
    with open(R("robustness.csv"), "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["variant", "book_sharpe", "hlp_sharpe", "sharpe_advantage",
                    "avg_wallets_in_book", "sign_survives"])
        for r in robustness_rows:
            w.writerow([r["variant"],
                        fmtf(r["book_sharpe"]), fmtf(r["hlp_sharpe"]),
                        fmtf(r["advantage"]),
                        f"{r['avg_book']:.1f}" if r["avg_book"] is not None else "",
                        r["sign_survives"]])

    # Exclusions log (wallet-dates excluded from evaluation, with reasons).
    with open(R("exclusions.csv"), "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["decision_date", "wallet", "reason"])
        for line in fetch_log:
            w.writerow(["", line.split()[0], " ".join(line.split()[1:])])
        for t in decisions:
            for wd in wallets:
                m = metrics_cache[(wd.address, t)]
                if m["excluded"] not in (None, "no_fills_in_window"):
                    w.writerow([iso(t), wd.address, m["excluded"]])
        # Eligible wallet-dates dropped from SCORING because a dimension was
        # undefined: absence of measurement, logged rather than ranked.
        for t in decisions:
            for wd, reason in score_cache[t][1]:
                w.writerow([iso(t), wd.address, reason])

    # Actuarial seed: per-window distribution of graduated-wallet outcomes
    # (spec §9 — the first row of MERIT's loss dataset).
    with open(R("actuarial_seed.csv"), "w", newline="") as fh:
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

    # Per-date score distribution over ALL eligible wallets (spec §9), so the
    # selection can be audited against the population it was drawn from.
    with open(R("score_distribution.csv"), "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["decision_date", "wallet", "archetype", "score_S", "selected"]
                   + [name for name, _ in SCORE_DIMS]
                   + [f"raw_{key}" for _, key in SCORE_DIMS])
        for t in decisions:
            scored, _ = score_cache[t]
            chosen = {s["wallet"].address for s in select_book(scored)}
            for s in sorted(scored, key=lambda x: -x["S"]):
                m = s["metrics"]
                w.writerow([iso(t), s["wallet"].address, s["wallet"].archetype,
                            f"{s['S']:.6f}",
                            s["wallet"].address in chosen]
                           + [f"{s['pct'][name]:.6f}" for name, _ in SCORE_DIMS]
                           + [f"{float(m[key]):.8f}" for _, key in SCORE_DIMS])

    # Predictive validity per decision date (spec §6/§9): S against forward
    # risk-adjusted performance, alongside the trailing-Sharpe foil.
    with open(R("predictive_validity.csv"), "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["decision_date", "n_wallets", "rank_corr_S_vs_forward",
                    "rank_corr_trailing_sharpe_vs_forward"])
        for r in percorr_rows:
            w.writerow([r["decision_date"], r["n"],
                        fmtf(r["rho_S"]), fmtf(r["rho_trailing_sharpe"])])


if __name__ == "__main__":
    sys.exit(main())
