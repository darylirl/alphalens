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
  const st = startTime ?? 1
  try {
    return await post({ type: 'userFillsByTime', user: address, startTime: st })
  } catch {
    // Fallback to legacy endpoint
    return post({ type: 'userFills', user: address })
  }
}

export async function getUserFundings(address: string, startTime?: number): Promise<UserFunding[]> {
  const st = startTime ?? 1
  // NB: the Hyperliquid type name is singular — 'userFundings' returns 422
  return post({ type: 'userFunding', user: address, startTime: st })
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

// NOTE: The Hyperliquid native leaderboard endpoint is deprecated.
// Use /api/leaderboard which builds a custom leaderboard from tracked Supabase wallets.
