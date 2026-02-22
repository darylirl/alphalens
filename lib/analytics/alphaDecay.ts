import { computeSharpe } from './pnl'
import type { Fill } from '@/lib/hyperliquid/types'

export function computeAlphaDecay(fills: Fill[]): number {
  if (fills.length < 30) return 0

  const sorted = [...fills].sort((a, b) => a.time - b.time)
  const dailyMap = new Map<string, number>()

  for (const fill of sorted) {
    const date = new Date(fill.time).toISOString().split('T')[0]
    const pnl = parseFloat(fill.closedPnl || '0')
    dailyMap.set(date, (dailyMap.get(date) || 0) + pnl)
  }

  const dailyPnls = Array.from(dailyMap.values())
  if (dailyPnls.length < 30) return 0

  const sharpe90 = computeSharpe(dailyPnls.slice(-90))
  const sharpe30 = computeSharpe(dailyPnls.slice(-30))

  if (sharpe90 === 0) return 0
  const decay = (sharpe90 - sharpe30) / Math.abs(sharpe90)
  return Math.round(Math.max(0, decay) * 1000) / 1000
}
