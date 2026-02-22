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
  if (dailyPnls.length < 3) return 0
  const mean = dailyPnls.reduce((a, b) => a + b, 0) / dailyPnls.length
  const variance = dailyPnls.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / dailyPnls.length
  const std = Math.sqrt(variance)
  if (std === 0) return 0
  return Math.round((mean / std) * Math.sqrt(365) * 1000) / 1000
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
