import type { Fill } from '@/lib/hyperliquid/types'

export interface DailyPnl {
  date: string
  pnl: number
  cumulative: number
}

export function computeDailyPnl(fills: Fill[]): DailyPnl[] {
  if (!fills.length) return []

  const sorted = [...fills].sort((a, b) => a.time - b.time)
  const dailyMap = new Map<string, number>()

  for (const fill of sorted) {
    const date = new Date(fill.time).toISOString().split('T')[0]
    const pnl = parseFloat(fill.closedPnl || '0')
    dailyMap.set(date, (dailyMap.get(date) || 0) + pnl)
  }

  let cumulative = 0
  const result: DailyPnl[] = []
  for (const [date, pnl] of dailyMap) {
    cumulative += pnl
    result.push({ date, pnl: Math.round(pnl * 100) / 100, cumulative: Math.round(cumulative * 100) / 100 })
  }

  return result
}

export function computeSharpe(dailyPnls: number[]): number {
  if (dailyPnls.length < 2) return NaN
  const mean = dailyPnls.reduce((a, b) => a + b, 0) / dailyPnls.length
  const variance = dailyPnls.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / (dailyPnls.length - 1)
  const std = Math.sqrt(variance)
  if (std === 0) return NaN
  return Math.round((mean / std) * Math.sqrt(365) * 1000) / 1000
}

/**
 * Compute Sharpe from individual fills when daily data is too sparse.
 * Groups by trade-level returns and annualizes.
 */
export function computeSharpeFromFills(fills: Fill[], windowDays?: number): number {
  let filtered = fills.filter(f => f.closedPnl && parseFloat(f.closedPnl) !== 0)
  if (windowDays) {
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000
    filtered = filtered.filter(f => f.time >= cutoff)
  }
  if (filtered.length < 10) return NaN

  const returns = filtered.map(f => parseFloat(f.closedPnl || '0'))
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1)
  const std = Math.sqrt(variance)
  if (std === 0) return NaN

  // Estimate trades per year based on density
  const sortedTimes = filtered.map(f => f.time).sort((a, b) => a - b)
  const spanMs = sortedTimes[sortedTimes.length - 1] - sortedTimes[0]
  const spanDays = Math.max(spanMs / (24 * 60 * 60 * 1000), 1)
  const tradesPerDay = filtered.length / spanDays
  const annualizationFactor = Math.sqrt(tradesPerDay * 365)

  return Math.round((mean / std) * annualizationFactor * 1000) / 1000
}

export function computeWinRate(fills: Fill[]): number {
  const closedFills = fills.filter(f => f.closedPnl && parseFloat(f.closedPnl) !== 0)
  if (!closedFills.length) return 0
  const wins = closedFills.filter(f => parseFloat(f.closedPnl) > 0).length
  return Math.round((wins / closedFills.length) * 1000) / 1000
}

export function computeMaxDrawdown(dailyPnls: number[]): number {
  if (!dailyPnls.length) return 0
  let peak = 0
  let maxDd = 0
  let cumulative = 0

  for (const pnl of dailyPnls) {
    cumulative += pnl
    if (cumulative > peak) peak = cumulative
    const dd = peak - cumulative
    if (dd > maxDd) maxDd = dd
  }

  return Math.round(maxDd * 100) / 100
}

export function computeTotalPnl(fills: Fill[]): number {
  return Math.round(
    fills.reduce((sum, f) => sum + parseFloat(f.closedPnl || '0'), 0) * 100
  ) / 100
}

export interface PnlPoint {
  timestamp: number
  pnl: number
}

export function buildPnlSeries(fills: Fill[]): PnlPoint[] {
  if (!fills.length) return []

  const sorted = [...fills].sort((a, b) => a.time - b.time)
  let running = 0
  const series: PnlPoint[] = []

  for (const fill of sorted) {
    running += parseFloat(fill.closedPnl || '0') - parseFloat(fill.fee || '0')
    series.push({
      timestamp: fill.time,
      pnl: Math.round(running * 100) / 100,
    })
  }

  return series
}
