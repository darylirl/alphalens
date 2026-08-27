#!/usr/bin/env python3
"""
test_graduation_v12.py — invariants of the v1.2 scoring pipeline.

These are the parts of backtest_graduation.py that decide who gets funded and
at what weight, so they are tested directly rather than inferred from a run.
Run: python3 test_graduation_v12.py
"""
import os
# The module exits at import if Supabase config is absent; these tests never
# touch the network, so a placeholder is enough to get past that check.
os.environ.setdefault("SUPABASE_URL", "https://example.invalid")
os.environ.setdefault("SUPABASE_ANON_KEY", "test")

import backtest_graduation as G

fails = []


def check(name, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f"  — {detail}" if detail else ""))
    if not cond:
        fails.append(name)


def approx(a, b, eps=1e-9):
    return abs(a - b) < eps


class FakeWallet:
    def __init__(self, address, first_ts=0, archetype="x"):
        self.address = address
        self.first_ts = first_ts
        self.archetype = archetype


def mk(dd=0.1, cv=1.0, pl=1.0, ex=0.3, liq=0, trips=100, days=40,
       med=1.0, excluded=None):
    return {"excluded": excluded, "n_trips": trips, "active_days": days,
            "dd_frac": dd, "cv": cv, "postloss_ratio": pl, "exposure_max": ex,
            "n_liq": liq, "med_daily_notional": med, "anchor": 10_000.0,
            "anchor_clamped": False}


def main():
    print("v1.2 scoring invariants (spec §2, §4)\n")

    # ── percentile_ranks: lower raw value = better = higher percentile ──────
    pr = G.percentile_ranks([0.5, 0.1, 0.3])          # 0.1 best, 0.5 worst
    check("lower-is-better maps to a higher percentile",
          pr[1] > pr[2] > pr[0], f"{[round(x,3) for x in pr]}")
    check("percentiles are strictly inside (0,1)",
          all(0 < x < 1 for x in pr))
    pr_t = G.percentile_ranks([1.0, 1.0, 1.0, 1.0])
    check("all-tied dimension gives every wallet the same percentile",
          len(set(round(x, 12) for x in pr_t)) == 1 and approx(pr_t[0], 0.5),
          f"{pr_t[0]:.3f}")
    pr_p = G.percentile_ranks([5.0, 1.0, 1.0, 9.0])
    check("ties share the averaged position", approx(pr_p[1], pr_p[2]),
          f"{pr_p[1]:.4f} vs {pr_p[2]:.4f}")
    check("single wallet scores 0.5, not 1.0 or 0.0",
          G.percentile_ranks([0.42]) == [0.5])

    # ── score_at: eligibility, S, and the undefined-dimension rule ──────────
    ws = [FakeWallet(f"0x{i:02d}", first_ts=1000 * i) for i in range(4)]
    mc = {
        (ws[0].address, 1): mk(dd=0.05, cv=0.5, pl=0.8, ex=0.2, liq=0),  # best
        (ws[1].address, 1): mk(dd=0.50, cv=3.0, pl=2.0, ex=0.9, liq=3),  # worst
        (ws[2].address, 1): mk(dd=0.20, cv=1.5, pl=1.2, ex=0.5, liq=1),
        (ws[3].address, 1): mk(trips=10),                                # floor fail
    }
    scored, unscorable = G.score_at(ws, 1, mc)
    check("wallets under the eligibility floor are not scored",
          len(scored) == 3 and all(s["wallet"].address != "0x03" for s in scored),
          f"n={len(scored)}")
    by = {s["wallet"].address: s["S"] for s in scored}
    check("S orders the uniformly-better wallet first",
          by["0x00"] > by["0x02"] > by["0x01"],
          " > ".join(f"{k}:{v:.3f}" for k, v in sorted(by.items())))
    check("S is the equally weighted mean of the five percentiles",
          all(approx(s["S"], sum(s["pct"].values()) / 5) for s in scored))
    check("S carries no returns/PnL term",
          all(k in {n for n, _ in G.SCORE_DIMS} for s in scored for k in s["pct"]))

    mc_u = dict(mc)
    mc_u[(ws[2].address, 1)] = mk(pl=None)     # undefined post-loss composure
    scored_u, unscorable_u = G.score_at(ws, 1, mc_u)
    check("an undefined dimension excludes the wallet-date from scoring",
          len(scored_u) == 2 and len(unscorable_u) == 1,
          f"scored={len(scored_u)} unscorable={len(unscorable_u)}")
    check("the exclusion names the missing dimension",
          "d3_postloss_composure" in unscorable_u[0][1], unscorable_u[0][1])
    check("an undefined dimension is NOT ranked as best",
          all(s["wallet"].address != "0x02" for s in scored_u))

    # ── select_book: top quintile, cap, deterministic ties ─────────────────
    big = [{"wallet": FakeWallet(f"0x{i:03d}"), "S": i / 100.0,
            "history_days": 0.0, "metrics": mk(), "pct": {}} for i in range(100)]
    sel = G.select_book(big, 0.20)
    check("top quintile of 100 selects 20", len(sel) == 20, f"n={len(sel)}")
    check("selection takes the HIGHEST S", sel[0]["S"] == 0.99 and sel[-1]["S"] == 0.80)
    sel10 = G.select_book(big, 0.10)
    sel30 = G.select_book(big, 0.30)
    check("robustness quantiles select 10 and 30",
          len(sel10) == 10 and len(sel30) == 30, f"{len(sel10)}/{len(sel30)}")
    huge = [{"wallet": FakeWallet(f"0x{i:04d}"), "S": i / 1000.0,
             "history_days": 0.0, "metrics": mk(), "pct": {}} for i in range(1000)]
    check("absolute 50-wallet cap binds above it",
          len(G.select_book(huge, 0.20)) == G.SELECT_CAP)
    tied = [{"wallet": FakeWallet("0xaa"), "S": 0.9, "history_days": 10.0,
             "metrics": mk(), "pct": {}},
            {"wallet": FakeWallet("0xbb"), "S": 0.9, "history_days": 99.0,
             "metrics": mk(), "pct": {}}]
    check("ties on S break toward the longer verified history",
          G.select_book(tied, 0.5)[0]["wallet"].address == "0xbb")
    check("a single eligible wallet still yields a book of 1",
          len(G.select_book(big[:1], 0.20)) == 1)

    # ── book_weights: S-proportional under the 5% cap ──────────────────────
    sel40 = G.select_book(
        [{"wallet": FakeWallet(f"0x{i:03d}"), "S": 0.5 + i / 1000.0,
          "history_days": 0.0, "metrics": mk(), "pct": {}} for i in range(200)],
        0.20)
    w = G.book_weights(sel40)
    check("no wallet exceeds the 5% cap",
          max(w) <= G.PER_WALLET_CAP + 1e-12, f"max={max(w):.6f}")
    check("a 40-wallet book is fully invested",
          approx(sum(w), 1.0, 1e-9), f"sum={sum(w):.12f}")
    check("higher S earns a higher (or capped-equal) weight",
          all(w[i] >= w[i + 1] - 1e-12 for i in range(len(w) - 1)))
    uncapped = [x for x in w if x < G.PER_WALLET_CAP - 1e-12]
    check("uncapped weights stay proportional to S",
          len(uncapped) < 2 or approx(
              uncapped[0] / uncapped[-1],
              sel40[w.index(uncapped[0])]["S"] / sel40[w.index(uncapped[-1])]["S"],
              1e-9))

    small = G.select_book(
        [{"wallet": FakeWallet(f"0x{i:03d}"), "S": 0.5 + i / 100.0,
          "history_days": 0.0, "metrics": mk(), "pct": {}} for i in range(50)],
        0.20)                                        # 10 wallets
    ws_small = G.book_weights(small)
    check("a 10-wallet book sits at the cap with the rest in cash",
          all(approx(x, G.PER_WALLET_CAP) for x in ws_small)
          and approx(sum(ws_small), 0.5),
          f"sum={sum(ws_small):.4f} → cash {1-sum(ws_small):.0%}")
    eq = G.book_weights(small, equal_weight=True)
    check("equal-weight variant (d) ignores S",
          len(set(round(x, 12) for x in eq)) == 1)
    check("empty book yields no weights", G.book_weights([]) == [])

    # ── spearman ───────────────────────────────────────────────────────────
    check("spearman is +1 on a monotone increasing pair",
          approx(G.spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1.0))
    check("spearman is -1 on a monotone decreasing pair",
          approx(G.spearman([1, 2, 3, 4], [40, 30, 20, 10]), -1.0))
    check("spearman is rank-based, not level-based",
          approx(G.spearman([1, 2, 3, 4], [1, 2, 3, 400]), 1.0))
    check("spearman refuses fewer than 3 points",
          G.spearman([1, 2], [1, 2]) is None)
    check("spearman returns None on a constant series",
          G.spearman([1, 1, 1, 1], [1, 2, 3, 4]) is None)

    # ── gate constants match the spec ──────────────────────────────────────
    check("eligibility floor is 60 trips / 30 active days",
          G.ELIGIBILITY == {"min_round_trips": 60, "min_active_days": 30})
    check("breadth floor 25 eligible, gate 12 qualifying dates",
          G.MIN_ELIGIBLE_FOR_QUALIFYING == 25 and G.MIN_QUALIFYING_DATES == 12)
    check("kill criterion 3 breadth is 15 wallets",
          G.MIN_BOOK_BREADTH == 15.0)
    check("capacity haircut 25% above USD 5M median daily notional",
          G.CAPACITY_HAIRCUT == 0.25
          and G.CAPACITY_MEDIAN_DAILY_NOTIONAL == 5_000_000.0)
    check("five process dimensions, no more and no fewer",
          len(G.SCORE_DIMS) == 5)

    print(f"\n{'ALL PASS' if not fails else str(len(fails)) + ' FAILED: ' + ', '.join(fails)}")
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
