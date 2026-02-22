import httpx
from typing import List, Dict, Any

BASE_URL = "https://api.hyperliquid.xyz/info"


async def post(payload: dict) -> Any:
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(BASE_URL, json=payload)
        r.raise_for_status()
        return r.json()


async def get_fills(address: str) -> List[Dict]:
    return await post({"type": "userFills", "user": address})


async def get_state(address: str) -> Dict:
    return await post({"type": "clearinghouseState", "user": address})


async def get_fundings(address: str) -> List[Dict]:
    return await post({"type": "userFundings", "user": address})


async def get_leaderboard() -> List[Dict]:
    return await post({"type": "leaderboard"})


async def get_meta_and_asset_ctxs() -> Any:
    return await post({"type": "metaAndAssetCtxs"})


async def get_candles(
    coin: str, interval: str, start_ms: int, end_ms: int
) -> List[Dict]:
    return await post(
        {
            "type": "candleSnapshot",
            "req": {
                "coin": coin,
                "interval": interval,
                "startTime": start_ms,
                "endTime": end_ms,
            },
        }
    )
