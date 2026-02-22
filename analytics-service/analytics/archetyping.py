import pandas as pd
from typing import Dict, List


def detect_archetype(fills: List[Dict], state: Dict) -> Dict:
    if not fills:
        return {"archetype": "unknown", "confidence": 0.0}

    df = pd.DataFrame(fills)
    df["time"] = pd.to_datetime(df["time"], unit="ms")
    df["pnl"] = df.get("closedPnl", pd.Series([0.0] * len(df))).astype(float)
    df["size"] = df["sz"].astype(float)
    df["price"] = df["px"].astype(float)

    trade_count = len(df)
    avg_size = (df["size"] * df["price"]).mean()
    pnl_std = df["pnl"].std()
    pnl_mean = df["pnl"].mean()

    df = df.sort_values("time")
    time_diffs = df["time"].diff().dt.total_seconds().dropna()
    avg_hold_seconds = (
        time_diffs.mean() if not time_diffs.empty else 3600
    )

    positions = state.get("assetPositions", [])
    leverages = []
    for p in positions:
        pos = p.get("position", {})
        lev = pos.get("leverage", {}).get("value")
        if lev:
            leverages.append(float(lev))
    avg_leverage = (
        sum(leverages) / len(leverages) if leverages else 5.0
    )

    scores = {}

    scalper = 0.0
    if avg_hold_seconds < 900:
        scalper += 0.4
    if trade_count > 50:
        scalper += 0.3
    if avg_leverage > 10:
        scalper += 0.3
    scores["scalper"] = scalper

    swing = 0.0
    if 14400 < avg_hold_seconds < 604800:
        swing += 0.5
    if 3 <= avg_leverage <= 10:
        swing += 0.3
    if 10 <= trade_count <= 50:
        swing += 0.2
    scores["swing_trader"] = swing

    momentum = 0.0
    if pnl_mean > 0:
        momentum += 0.4
    if avg_leverage > 5:
        momentum += 0.3
    if avg_hold_seconds < 86400:
        momentum += 0.3
    scores["momentum_trader"] = momentum

    conviction = 0.0
    if trade_count < 20:
        conviction += 0.4
    if avg_size > 10000:
        conviction += 0.3
    if avg_leverage <= 5:
        conviction += 0.3
    scores["high_conviction"] = conviction

    funding_arb = 0.0
    if pnl_std < 100 and avg_leverage < 5:
        funding_arb += 0.6
    if trade_count < 15:
        funding_arb += 0.4
    scores["funding_arb"] = funding_arb

    archetype = max(scores, key=scores.get)
    confidence = round(scores[archetype], 2)

    return {
        "archetype": archetype,
        "confidence": confidence,
        "scores": scores,
        "avg_hold_seconds": round(avg_hold_seconds),
        "avg_leverage": round(avg_leverage, 2),
    }
