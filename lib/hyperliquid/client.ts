const BASE_URL = 'https://api.hyperliquid.xyz/info'

async function post<T>(payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    next: { revalidate: 30 },
  })

  if (!res.ok) {
    throw new Error(`Hyperliquid API error: ${res.status} ${res.statusText}`)
  }

  return res.json()
}

import type {
  ClearinghouseState,
  Fill,
  UserFunding,
  OpenOrder,
  L2Book,
  Candle,
  AssetCtx,
  AssetMeta,
} from './types'

export async function getClearinghouseState(address: string): Promise<ClearinghouseState> {
  return post({ type: 'clearinghouseState', user: address })
}

export async function getUserFills(address: string, startTime?: number): Promise<Fill[]> {
  const st = startTime || new Date('2023-01-01').getTime()
  try {
    return await post({ type: 'userFillsByTime', user: address, startTime: st, aggregateByTime: false })
  } catch {
    // Fallback to legacy endpoint
    return post({ type: 'userFills', user: address })
  }
}

export async function getUserFundings(address: string, startTime?: number): Promise<UserFunding[]> {
  const st = startTime || new Date('2023-01-01').getTime()
  return post({ type: 'userFundings', user: address, startTime: st })
}

export async function getOpenOrders(address: string): Promise<OpenOrder[]> {
  return post({ type: 'openOrders', user: address })
}

export async function getAllMids(): Promise<Record<string, string>> {
  return post({ type: 'allMids' })
}

export async function getMetaAndAssetCtxs(): Promise<[{ universe: AssetMeta[] }, AssetCtx[]]> {
  return post({ type: 'metaAndAssetCtxs' })
}

export async function getL2Book(coin: string): Promise<L2Book> {
  return post({ type: 'l2Book', coin })
}

export async function getCandleSnapshot(
  coin: string,
  interval: string,
  startTime: number,
  endTime: number
): Promise<Candle[]> {
  return post({
    type: 'candleSnapshot',
    req: { coin, interval, startTime, endTime },
  })
}

export async function getLeaderboard(): Promise<{ leaderboardRows: Array<{ ethAddress: string; accountValue: string; displayName: string | null; windowPerformances: Array<{ window: string; pnl: string; roi: string }> }> }> {
  return post({ type: 'leaderboard' })
}
