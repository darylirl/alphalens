import type { Fill, ClearinghouseState } from '@/lib/hyperliquid/types'

export type ArchetypeType = 'scalper' | 'swing_trader' | 'momentum_trader' | 'high_conviction' | 'funding_arb' | 'unknown'

export interface ArchetypeResult {
  archetype: ArchetypeType
  confidence: number
  scores: Record<string, number>
}

export function detectArchetype(fills: Fill[], state: ClearinghouseState): ArchetypeResult {
  if (!fills.length) return { archetype: 'unknown', confidence: 0, scores: {} }

  const sorted = [...fills].sort((a, b) => a.time - b.time)

  // Compute avg hold time from consecutive fills
  let totalTimeDiff = 0
  let diffCount = 0
  for (let i = 1; i < sorted.length; i++) {
    totalTimeDiff += sorted[i].time - sorted[i - 1].time
    diffCount++
  }
  const avgHoldMs = diffCount > 0 ? totalTimeDiff / diffCount : 3600000
  const avgHoldSeconds = avgHoldMs / 1000

  const tradeCount = fills.length
  const avgSize = fills.reduce((s, f) => s + parseFloat(f.sz) * parseFloat(f.px), 0) / fills.length

  const pnls = fills.map(f => parseFloat(f.closedPnl || '0'))
  const pnlMean = pnls.reduce((a, b) => a + b, 0) / pnls.length
  const pnlStd = Math.sqrt(pnls.reduce((s, p) => s + Math.pow(p - pnlMean, 2), 0) / pnls.length)

  // Leverage from state
  const leverages: number[] = []
  for (const ap of state.assetPositions) {
    const lev = ap.position.leverage?.value
    if (lev) leverages.push(lev)
  }
  const avgLeverage = leverages.length > 0 ? leverages.reduce((a, b) => a + b, 0) / leverages.length : 5

  const scores: Record<string, number> = {}

  // Scalper
  let scalper = 0
  if (avgHoldSeconds < 900) scalper += 0.4
  if (tradeCount > 50) scalper += 0.3
  if (avgLeverage > 10) scalper += 0.3
  scores.scalper = scalper

  // Swing trader
  let swing = 0
  if (avgHoldSeconds > 14400 && avgHoldSeconds < 604800) swing += 0.5
  if (avgLeverage >= 3 && avgLeverage <= 10) swing += 0.3
  if (tradeCount >= 10 && tradeCount <= 50) swing += 0.2
  scores.swing_trader = swing

  // Momentum
  let momentum = 0
  if (pnlMean > 0) momentum += 0.4
  if (avgLeverage > 5) momentum += 0.3
  if (avgHoldSeconds < 86400) momentum += 0.3
  scores.momentum_trader = momentum

  // High conviction
  let conviction = 0
  if (tradeCount < 20) conviction += 0.4
  if (avgSize > 10000) conviction += 0.3
  if (avgLeverage <= 5) conviction += 0.3
  scores.high_conviction = conviction

  // Funding arb
  let fundingArb = 0
  if (pnlStd < 100 && avgLeverage < 5) fundingArb += 0.6
  if (tradeCount < 15) fundingArb += 0.4
  scores.funding_arb = fundingArb

  const archetype = Object.entries(scores).reduce((best, [k, v]) => v > best[1] ? [k, v] : best, ['unknown', 0])

  return {
    archetype: archetype[0] as ArchetypeType,
    confidence: Math.round(archetype[1] as number * 100) / 100,
    scores
  }
}
