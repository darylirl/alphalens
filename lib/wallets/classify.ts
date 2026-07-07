import { getUserFills, getClearinghouseState } from '../hyperliquid/client'
import type { Fill, ClearinghouseState } from '../hyperliquid/types'

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

export interface TradeGroup {
  coin: string
  /** Direction of the position: 'B' = long, 'A' = short */
  side: 'B' | 'A'
  entryTime: number
  exitTime: number | null
  entryPx: number
  closedPnl: number
  notional: number
  /** Entry predates the fill window, so the hold time is a lower bound only */
  truncated: boolean
}

/**
 * Classify a wallet into one or more trader archetypes from its fills and
 * current positions. The fills endpoint serves at most ~2000 of the wallet's
 * most recent fills (older history is not queryable), so for hyperactive
 * wallets this is a recent-activity sample rather than the full 90 days —
 * computeTags detects the truncation and rate-normalizes accordingly.
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

/** Honestly-derived wallet metrics: values are null when the fill sample
 *  provides no real evidence for them — callers must not fabricate defaults. */
export interface WalletMetrics {
  tags: Archetype[]
  /** 30d-equivalent fill count (rate-extrapolated when the sample is capped) */
  tradeCount30d: number
  /** null when fewer than MIN_HOLD_SAMPLES measured round trips */
  avgHoldSeconds: number | null
  /** null when no completed round trips exist in the sample */
  winRate: number | null
  closedTradeCount: number
  uniqueCoins: number
  /** Coin with the most fills in the sample */
  mostTradedCoin: string | null
  twoSidedShare: number
}

export function computeTags(fills: Fill[], state: ClearinghouseState): Archetype[] {
  return computeWalletMetrics(fills, state).tags
}

export function computeWalletMetrics(fills: Fill[], state: ClearinghouseState): WalletMetrics {
  if (!fills || fills.length === 0) {
    return {
      tags: ['unclassified'], tradeCount30d: 0, avgHoldSeconds: null,
      winRate: null, closedTradeCount: 0, uniqueCoins: 0,
      mostTradedCoin: null, twoSidedShare: 0,
    }
  }

  const tags: Archetype[] = []

  // --- Derived metrics ---
  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000
  const thirtyDaysAgo = now - 30 * dayMs

  // The fills endpoint serves at most ~2000 of a wallet's MOST RECENT fills;
  // older history is not queryable (verified empirically — endTime paging
  // returns nothing beyond the retained set). For hyperactive wallets the
  // sample can span mere hours, so frequency metrics must be rate-based over
  // the actually-covered window, not naively counted against "30 days".
  const FILL_CAP = 2000
  const capped = fills.length >= FILL_CAP
  let newestFill = -Infinity
  let oldestFill = Infinity
  for (const f of fills) {
    if (f.time > newestFill) newestFill = f.time
    if (f.time < oldestFill) oldestFill = f.time
  }
  const coveredDays = Math.max((newestFill - oldestFill) / dayMs, 1 / 24) // ≥1h floor
  const windowCovers30d = oldestFill <= thirtyDaysAgo

  // Fills in last 30 days for frequency metrics
  const recentFills = fills.filter(f => f.time >= thirtyDaysAgo)

  // 30d-equivalent trade count: direct count when the sample fully covers the
  // last 30 days; rate-extrapolated when the cap truncated the window.
  const tradeCount30d = (!capped || windowCovers30d)
    ? recentFills.length
    : Math.round((fills.length / coveredDays) * 30)

  // Unique coins traded recently
  const uniqueCoinsRecent = new Set(recentFills.map(f => f.coin))

  // Two-sided trading share: of recently active coins (≥4 fills), the share
  // the wallet traded on BOTH sides — the market-maker signature that needs
  // no hold-time evidence (a real MM measured 93% here).
  const coinSideMap = new Map<string, { sides: Set<string>; count: number }>()
  for (const f of recentFills) {
    let e = coinSideMap.get(f.coin)
    if (!e) { e = { sides: new Set(), count: 0 }; coinSideMap.set(f.coin, e) }
    e.sides.add(f.side)
    e.count++
  }
  const activeCoins = [...coinSideMap.values()].filter(e => e.count >= 4)
  const twoSidedShare = activeCoins.length > 0
    ? activeCoins.filter(e => e.sides.size === 2).length / activeCoins.length
    : 0

  // Average notional per trade
  const notionals = fills.map(f => Math.abs(parseFloat(f.px) * parseFloat(f.sz)))
  const avgNotional = notionals.length > 0 ? notionals.reduce((a, b) => a + b, 0) / notionals.length : 0

  // Trade grouping for hold time calculation
  const tradeGroups = computeTradeGroups(fills)
  const closedTrades = tradeGroups.filter(g => g.exitTime !== null)

  // Truncated trips entered before the fill window — their duration is a
  // lower bound, so exclude them from hold-time stats (PnL is still valid).
  const holdTimes = closedTrades
    .filter(g => !g.truncated)
    .map(g => (g.exitTime! - g.entryTime) / 1000) // seconds

  // Hold-time rules need real evidence: at least 3 measured round trips.
  // Without it, avgHold defaults are meaningless — the old behavior of
  // defaulting to 0 silently satisfied every "hold < X" condition.
  const MIN_HOLD_SAMPLES = 3
  const holdKnown = holdTimes.length >= MIN_HOLD_SAMPLES
  const avgHoldSeconds = holdTimes.length > 0
    ? holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length
    : 0
  const avgHoldMinutes = avgHoldSeconds / 60
  const avgHoldHours = avgHoldMinutes / 60
  const avgHoldDays = avgHoldHours / 24

  // Win rate — null (unknown) when no round trips completed in the sample
  const wins = closedTrades.filter(g => g.closedPnl > 0).length
  const winRateOrNull = closedTrades.length > 0 ? wins / closedTrades.length : null
  const winRate = winRateOrNull ?? 0

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

  // market_maker: 200+ trades/30d across 5+ coins, evidenced by either
  // two-sided quoting (works even when positions never go flat) or a
  // measured sub-30-minute average hold
  if (
    tradeCount30d >= 200 &&
    uniqueCoinsRecent.size >= 5 &&
    (twoSidedShare >= 0.6 || (holdKnown && avgHoldMinutes < 30))
  ) {
    tags.push('market_maker')
  }

  // scalper: measured avg hold < 15min, 100+ trades/30d
  if (holdKnown && avgHoldMinutes < 15 && tradeCount30d >= 100) {
    tags.push('scalper')
  }

  // momentum_trader: measured avg hold 4-72h, win rate > 55%, 1-3 coins
  if (holdKnown && avgHoldHours >= 4 && avgHoldHours <= 72 && winRate > 0.55 && topCoinsCount <= 3) {
    tags.push('momentum_trader')
  }

  // basis_trader: funding > 20% of total PnL, measured avg hold > 7 days
  if (holdKnown && fundingRatio >= 0.2 && fundingPnl > 0 && avgHoldDays >= 7) {
    tags.push('basis_trader')
  }

  // swing_trader: measured avg hold 3-14 days, < 50 trades/30d
  if (holdKnown && avgHoldDays >= 3 && avgHoldDays <= 14 && tradeCount30d < 50) {
    tags.push('swing_trader')
  }

  if (tags.length === 0) {
    tags.push('unclassified')
  }

  return {
    tags,
    tradeCount30d,
    avgHoldSeconds: holdKnown ? Math.round(avgHoldSeconds) : null,
    winRate: winRateOrNull,
    closedTradeCount: closedTrades.length,
    uniqueCoins: coinCounts.size,
    mostTradedCoin: sortedCoins[0]?.[0] ?? null,
    twoSidedShare: Math.round(twoSidedShare * 100) / 100,
  }
}

const POSITION_EPS = 1e-9

/**
 * Reconstruct round-trip trades from fills by tracking the signed position
 * per coin. A trade spans from the fill that takes the position off flat
 * (or through a direction flip) to the fill that returns it to flat (or
 * flips it again). Hyperliquid reports the signed pre-fill position on every
 * fill (`startPosition`, negative for shorts), which both self-corrects any
 * drift and lets us detect positions whose entries predate the fill window.
 */
export function computeTradeGroups(fills: Fill[]): TradeGroup[] {
  const groups: TradeGroup[] = []
  const sorted = [...fills].sort((a, b) => a.time - b.time)

  interface OpenTrip {
    entryTime: number
    entryPx: number
    closedPnl: number
    notional: number
    truncated: boolean
  }

  const running = new Map<string, number>() // signed position per coin
  const open = new Map<string, OpenTrip>()

  for (const fill of sorted) {
    const coin = fill.coin
    const sz = parseFloat(fill.sz)
    const px = parseFloat(fill.px)
    if (!isFinite(sz) || !isFinite(px) || sz === 0) continue

    const delta = fill.side === 'B' ? sz : -sz
    const reported = parseFloat(fill.startPosition)
    const prev = isFinite(reported) ? reported : (running.get(coin) ?? 0)
    const next = prev + delta
    running.set(coin, Math.abs(next) < POSITION_EPS ? 0 : next)

    const pnl = parseFloat(fill.closedPnl || '0') || 0
    const notional = Math.abs(px * sz)

    const prevFlat = Math.abs(prev) < POSITION_EPS
    const nextFlat = Math.abs(next) < POSITION_EPS
    const flipped = !prevFlat && !nextFlat && Math.sign(prev) !== Math.sign(next)

    if (prevFlat && !nextFlat) {
      // Position opened from flat
      open.set(coin, { entryTime: fill.time, entryPx: px, closedPnl: pnl, notional, truncated: false })
      continue
    }
    if (prevFlat && nextFlat) continue // no position change (defensive)

    let trip = open.get(coin)
    if (!trip) {
      // The fill window starts mid-position: track the remainder as a
      // truncated trip so partial closes aggregate into one trade instead of
      // becoming spurious zero-duration trades.
      trip = { entryTime: fill.time, entryPx: px, closedPnl: 0, notional: 0, truncated: true }
      open.set(coin, trip)
    }

    trip.closedPnl += pnl
    trip.notional += notional

    if (nextFlat || flipped) {
      groups.push({
        coin,
        side: prev > 0 ? 'B' : 'A',
        entryTime: trip.entryTime,
        exitTime: fill.time,
        entryPx: trip.entryPx,
        closedPnl: trip.closedPnl,
        notional: trip.notional,
        truncated: trip.truncated,
      })
      open.delete(coin)
      if (flipped) {
        // The residual becomes a fresh position in the opposite direction
        open.set(coin, {
          entryTime: fill.time,
          entryPx: px,
          closedPnl: 0,
          notional: Math.abs(px * next),
          truncated: false,
        })
      }
    }
  }

  // Positions still open at the end have no exit; report them so callers can
  // see activity, but with exitTime null they are excluded from hold/win stats.
  for (const [coin, trip] of open) {
    const pos = running.get(coin) ?? 0
    groups.push({
      coin,
      side: pos >= 0 ? 'B' : 'A',
      entryTime: trip.entryTime,
      exitTime: null,
      entryPx: trip.entryPx,
      closedPnl: trip.closedPnl,
      notional: trip.notional,
      truncated: trip.truncated,
    })
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
