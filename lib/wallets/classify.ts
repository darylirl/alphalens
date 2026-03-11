import { getUserFills, getClearinghouseState } from '@/lib/hyperliquid/client'
import type { Fill, ClearinghouseState } from '@/lib/hyperliquid/types'

export type Archetype =
  | 'market_maker'
  | 'momentum_trader'
  | 'basis_trader'
  | 'whale'
  | 'scalper'
  | 'swing_trader'
  | 'unclassified'

export interface ClassificationResult {
  address: string
  tags: Archetype[]
}

interface TradeGroup {
  coin: string
  side: 'B' | 'A'
  entryTime: number
  exitTime: number | null
  entryPx: number
  closedPnl: number
  notional: number
}

/**
 * Classify a wallet into one or more trader archetypes based on
 * 90 days of fills and current positions.
 */
export async function classifyWallet(address: string): Promise<ClassificationResult> {
  const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000

  const [fills, state] = await Promise.all([
    getUserFills(address, ninetyDaysAgo),
    getClearinghouseState(address),
  ])

  const tags = computeTags(fills, state)

  return { address: address.toLowerCase(), tags }
}

export function computeTags(fills: Fill[], state: ClearinghouseState): Archetype[] {
  if (!fills || fills.length === 0) return ['unclassified']

  const tags: Archetype[] = []

  // --- Derived metrics ---
  const now = Date.now()
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000

  // Fills in last 30 days for frequency metrics
  const recentFills = fills.filter(f => f.time >= thirtyDaysAgo)
  const tradeCount30d = recentFills.length

  // Unique coins traded
  const uniqueCoins = new Set(fills.map(f => f.coin))
  const uniqueCoinsRecent = new Set(recentFills.map(f => f.coin))

  // Average notional per trade
  const notionals = fills.map(f => Math.abs(parseFloat(f.px) * parseFloat(f.sz)))
  const avgNotional = notionals.length > 0 ? notionals.reduce((a, b) => a + b, 0) / notionals.length : 0

  // Trade grouping for hold time calculation
  const tradeGroups = computeTradeGroups(fills)
  const holdTimes = tradeGroups
    .filter(g => g.exitTime !== null)
    .map(g => (g.exitTime! - g.entryTime) / 1000) // seconds

  const avgHoldSeconds = holdTimes.length > 0
    ? holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length
    : 0
  const avgHoldMinutes = avgHoldSeconds / 60
  const avgHoldHours = avgHoldMinutes / 60
  const avgHoldDays = avgHoldHours / 24

  // Win rate
  const closedTrades = tradeGroups.filter(g => g.exitTime !== null)
  const wins = closedTrades.filter(g => g.closedPnl > 0).length
  const winRate = closedTrades.length > 0 ? wins / closedTrades.length : 0

  // Funding income estimation from positions
  const fundingPnl = estimateFundingPnl(state)
  const totalClosedPnl = fills.reduce((sum, f) => sum + parseFloat(f.closedPnl || '0'), 0)
  const totalPnl = totalClosedPnl + fundingPnl
  const fundingRatio = totalPnl !== 0 ? Math.abs(fundingPnl) / Math.abs(totalPnl) : 0

  // Most concentrated coins (for momentum check)
  const coinCounts = new Map<string, number>()
  for (const f of fills) {
    coinCounts.set(f.coin, (coinCounts.get(f.coin) || 0) + 1)
  }
  const sortedCoins = [...coinCounts.entries()].sort((a, b) => b[1] - a[1])
  const topCoinsCount = sortedCoins.length

  // --- Classification rules ---

  // whale: avg notional > $500K
  if (avgNotional >= 500_000) {
    tags.push('whale')
  }

  // market_maker: 200+ trades/30d, avg hold < 30min, 5+ coins
  if (tradeCount30d >= 200 && avgHoldMinutes < 30 && uniqueCoinsRecent.size >= 5) {
    tags.push('market_maker')
  }

  // scalper: avg hold < 15min, 100+ trades/30d, high frequency in single coin
  if (avgHoldMinutes < 15 && tradeCount30d >= 100) {
    tags.push('scalper')
  }

  // momentum_trader: avg hold 4-72h, win rate > 55%, concentrated in 1-3 coins
  if (avgHoldHours >= 4 && avgHoldHours <= 72 && winRate > 0.55 && topCoinsCount <= 3) {
    tags.push('momentum_trader')
  }

  // basis_trader: funding > 20% of total PnL, avg hold > 7 days
  if (fundingRatio >= 0.2 && fundingPnl > 0 && avgHoldDays >= 7) {
    tags.push('basis_trader')
  }

  // swing_trader: avg hold 3-14 days, < 50 trades/30d
  if (avgHoldDays >= 3 && avgHoldDays <= 14 && tradeCount30d < 50) {
    tags.push('swing_trader')
  }

  if (tags.length === 0) {
    tags.push('unclassified')
  }

  return tags
}

/**
 * Group fills into trade entries/exits by coin and direction.
 * A trade group is opened when a position increases and closed when it decreases.
 */
function computeTradeGroups(fills: Fill[]): TradeGroup[] {
  const groups: TradeGroup[] = []

  // Sort by time ascending
  const sorted = [...fills].sort((a, b) => a.time - b.time)

  // Track open positions per coin
  const openPositions = new Map<string, { entryTime: number; totalPnl: number; notional: number; entryPx: number; side: 'B' | 'A' }>()

  for (const fill of sorted) {
    const key = `${fill.coin}_${fill.side}`
    const closedPnl = parseFloat(fill.closedPnl || '0')
    const notional = Math.abs(parseFloat(fill.px) * parseFloat(fill.sz))

    if (closedPnl !== 0) {
      // This fill is closing a position
      const opposite = `${fill.coin}_${fill.side === 'B' ? 'A' : 'B'}`
      const open = openPositions.get(opposite)
      if (open) {
        groups.push({
          coin: fill.coin,
          side: open.side,
          entryTime: open.entryTime,
          exitTime: fill.time,
          entryPx: open.entryPx,
          closedPnl: open.totalPnl + closedPnl,
          notional: open.notional,
        })
        openPositions.delete(opposite)
      } else {
        // No matching open — treat as standalone closed trade
        groups.push({
          coin: fill.coin,
          side: fill.side,
          entryTime: fill.time,
          exitTime: fill.time,
          entryPx: parseFloat(fill.px),
          closedPnl,
          notional,
        })
      }
    } else {
      // Opening or adding to position
      const existing = openPositions.get(key)
      if (existing) {
        existing.totalPnl += closedPnl
        existing.notional += notional
      } else {
        openPositions.set(key, {
          entryTime: fill.time,
          totalPnl: 0,
          notional,
          entryPx: parseFloat(fill.px),
          side: fill.side,
        })
      }
    }
  }

  return groups
}

/**
 * Estimate cumulative funding PnL from current position state.
 * This is a rough heuristic based on cumulative funding field.
 */
function estimateFundingPnl(state: ClearinghouseState): number {
  let total = 0
  for (const ap of state.assetPositions || []) {
    const pos = ap?.position as unknown as Record<string, unknown>
    if (!pos) continue
    // cumFunding exists on the API response but not in our TS type
    const cumFunding = pos.cumFunding as { sinceOpen?: string } | undefined
    const funding = parseFloat(cumFunding?.sinceOpen || '0')
    total += funding
  }
  return total
}
