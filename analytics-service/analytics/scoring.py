import numpy as np
import pandas as pd
from typing import List, Dict
from fastapi import APIRouter
from ingestion.hyperliquid import get_fills, get_state

router = APIRouter()


def compute_pnl_series(fills: List[Dict]) -> pd.Series:
    df = pd.DataFrame(fills)
    if df.empty:
        return pd.Series(dtype=float)
    df["time"] = pd.to_datetime(df["time"], unit="ms")
    df = df.sort_values("time")
    df["pnl"] = df.get("closedPnl", pd.Series([0.0] * len(df))).astype(float)
    daily = df.groupby(df["time"].dt.date)["pnl"].sum()
    return daily


def compute_sharpe(daily_pnl: pd.Series) -> float:
    if len(daily_pnl) < 3:
        return 0.0
    mean = daily_pnl.mean()
    std = daily_pnl.std()
    if std == 0:
        return 0.0
    return round(float((mean / std) * np.sqrt(365)), 3)


def compute_win_rate(fills: List[Dict]) -> float:
    pnls = [
        float(f.get("closedPnl", 0))
        for f in fills
        if f.get("closedPnl") is not None
    ]
    if not pnls:
        return 0.0
    wins = sum(1 for p in pnls if p > 0)
    return round(wins / len(pnls), 3)


def compute_alpha_decay(fills: List[Dict]) -> float:
    daily = compute_pnl_series(fills)
    if len(daily) < 30:
        return 0.0
    sharpe_90 = compute_sharpe(daily.tail(90))
    sharpe_30 = compute_sharpe(daily.tail(30))
    if sharpe_90 == 0:
        return 0.0
    decay = (sharpe_90 - sharpe_30) / abs(sharpe_90)
    return round(max(0, decay), 3)


def compute_max_drawdown(fills: List[Dict]) -> float:
    daily = compute_pnl_series(fills)
    if daily.empty:
        return 0.0
    cumulative = daily.cumsum()
    rolling_max = cumulative.cummax()
    drawdown = cumulative - rolling_max
    return round(float(drawdown.min()), 2)


def score_wallet(fills: List[Dict]) -> Dict:
    daily = compute_pnl_series(fills)
    return {
        "sharpe_7d": compute_sharpe(daily.tail(7)),
        "sharpe_30d": compute_sharpe(daily.tail(30)),
        "sharpe_90d": compute_sharpe(daily.tail(90)),
        "win_rate": compute_win_rate(fills),
        "alpha_decay_score": compute_alpha_decay(fills),
        "max_drawdown": compute_max_drawdown(fills),
        "total_pnl": round(
            sum(float(f.get("closedPnl", 0)) for f in fills), 2
        ),
        "trade_count_30d": len(fills),
    }


@router.get("/score/{address}")
async def get_wallet_score(address: str):
    fills = await get_fills(address)
    return score_wallet(fills)


@router.get("/profile/{address}")
async def get_wallet_profile(address: str):
    fills = await get_fills(address)
    state = await get_state(address)
    from analytics.archetyping import detect_archetype

    archetype = detect_archetype(fills, state)
    scores = score_wallet(fills)
    return {**scores, **archetype, "address": address}
