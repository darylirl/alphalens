import type { Fill } from '@/lib/hyperliquid/types'

interface FillsCache {
  fills: Fill[]
  lastFetchedAt: number
  lastFillTime: number
}

const CACHE_KEY_PREFIX = 'alphalens_fills_'

function getCacheKey(address: string): string {
  return `${CACHE_KEY_PREFIX}${address.toLowerCase()}`
}

export function getCachedFills(address: string): FillsCache | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(getCacheKey(address))
    if (!raw) return null
    return JSON.parse(raw) as FillsCache
  } catch {
    return null
  }
}

export function setCachedFills(address: string, fills: Fill[]): void {
  if (typeof window === 'undefined') return
  if (!fills.length) return
  try {
    const sorted = [...fills].sort((a, b) => a.time - b.time)
    const cache: FillsCache = {
      fills: sorted,
      lastFetchedAt: Date.now(),
      lastFillTime: sorted[sorted.length - 1].time,
    }
    localStorage.setItem(getCacheKey(address), JSON.stringify(cache))
  } catch {
    // localStorage might be full; silently ignore
  }
}

export function mergeFills(cached: Fill[], fresh: Fill[]): Fill[] {
  const seen = new Set(cached.map(f => f.hash))
  const merged = [...cached]
  for (const fill of fresh) {
    if (!seen.has(fill.hash)) {
      merged.push(fill)
      seen.add(fill.hash)
    }
  }
  return merged.sort((a, b) => a.time - b.time)
}
