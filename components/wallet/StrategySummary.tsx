'use client'
import { useMemo } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { Target, Clock, TrendingUp, BarChart3, Shield, Zap, Copy } from 'lucide-react'
import type { Fill, ClearinghouseState } from '@/lib/hyperliquid/types'

interface StrategySummaryProps {
  fills: Fill[]
  state: ClearinghouseState
  address: string
  analytics: {
    archetype: string
    winRate: number
    totalPnl: number
    sharpe30d: number
    alphaDecay: number
    tradeCount: number
  }
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`
  return `${(seconds / 86400).toFixed(1)}d`
}

function formatUsd(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `$${(abs / 1e3).toFixed(0)}K`
  return `$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

export function StrategySummary({ fills, state, address, analytics }: StrategySummaryProps) {
  const insights = useMemo(() => {
    if (fills.length < 3) return null

    // Top assets by trade frequency
    const assetCounts: Record<string, { count: number; pnl: number; volume: number }> = {}
    fills.forEach(f => {
      if (!assetCounts[f.coin]) assetCounts[f.coin] = { count: 0, pnl: 0, volume: 0 }
      assetCounts[f.coin].count++
      assetCounts[f.coin].pnl += parseFloat(f.closedPnl || '0')
      assetCounts[f.coin].volume += parseFloat(f.sz) * parseFloat(f.px)
    })
    const topAssets = Object.entries(assetCounts)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([coin, data]) => ({ coin, ...data }))

    // Average hold duration (estimate from consecutive fills on same coin)
    const holdDurations: number[] = []
    const openTimes: Record<string, number> = {}
    fills.forEach(f => {
      const key = `${f.coin}-${f.side}`
      if (f.dir.includes('Open')) {
        openTimes[key] = f.time
      } else if (f.dir.includes('Close') && openTimes[`${f.coin}-${f.side === 'B' ? 'A' : 'B'}`]) {
        const openKey = `${f.coin}-${f.side === 'B' ? 'A' : 'B'}`
        holdDurations.push((f.time - openTimes[openKey]) / 1000)
        delete openTimes[openKey]
      }
    })
    const avgHoldSeconds = holdDurations.length > 0
      ? holdDurations.reduce((s, d) => s + d, 0) / holdDurations.length
      : 0

    // Sizing behavior
    const sizes = fills.map(f => parseFloat(f.sz) * parseFloat(f.px))
    const avgSize = sizes.reduce((s, v) => s + v, 0) / sizes.length
    const maxSize = Math.max(...sizes)
    const sizeVariance = sizes.length > 1
      ? Math.sqrt(sizes.reduce((s, v) => s + (v - avgSize) ** 2, 0) / sizes.length) / avgSize
      : 0

    // Direction bias
    const longs = fills.filter(f => f.side === 'B').length
    const shorts = fills.filter(f => f.side === 'A').length
    const longPct = Math.round((longs / (longs + shorts)) * 100)

    // Leverage from positions
    const leverages = state.assetPositions
      .filter(p => parseFloat(p.position.szi) !== 0)
      .map(p => p.position.leverage.value)
    const avgLeverage = leverages.length > 0
      ? leverages.reduce((s, v) => s + v, 0) / leverages.length
      : 0

    // Win/loss streak analysis
    let currentStreak = 0
    let maxWinStreak = 0
    let maxLossStreak = 0
    fills.forEach(f => {
      const pnl = parseFloat(f.closedPnl || '0')
      if (pnl > 0) {
        currentStreak = currentStreak > 0 ? currentStreak + 1 : 1
        maxWinStreak = Math.max(maxWinStreak, currentStreak)
      } else if (pnl < 0) {
        currentStreak = currentStreak < 0 ? currentStreak - 1 : -1
        maxLossStreak = Math.max(maxLossStreak, Math.abs(currentStreak))
      }
    })

    // Time-of-day pattern
    const hourCounts = Array(24).fill(0)
    fills.forEach(f => {
      const hour = new Date(f.time).getUTCHours()
      hourCounts[hour]++
    })
    const peakHour = hourCounts.indexOf(Math.max(...hourCounts))
    const peakHourEnd = (peakHour + 4) % 24

    // Sizing pattern
    let sizingPattern: string
    if (sizeVariance > 1.5) {
      sizingPattern = 'Scales aggressively on conviction — position sizes vary significantly between trades'
    } else if (sizeVariance > 0.7) {
      sizingPattern = 'Moderate size variation — adjusts position size based on setup quality'
    } else {
      sizingPattern = 'Consistent sizing — uses uniform position sizes across trades'
    }

    // Market condition preference
    let marketCondition: string
    if (avgHoldSeconds > 86400) {
      marketCondition = 'Prefers trending markets — holds through noise for multi-day moves'
    } else if (avgHoldSeconds > 3600) {
      marketCondition = 'Adapts to both trending and ranging — holds for hours, exits at key levels'
    } else {
      marketCondition = 'Thrives in volatile, liquid conditions — quick in-and-out on momentum'
    }

    // Exit style
    const closingFills = fills.filter(f => f.dir.includes('Close'))
    const profitableCloses = closingFills.filter(f => parseFloat(f.closedPnl || '0') > 0)
    const avgWin = profitableCloses.length > 0
      ? profitableCloses.reduce((s, f) => s + parseFloat(f.closedPnl || '0'), 0) / profitableCloses.length
      : 0
    const losingCloses = closingFills.filter(f => parseFloat(f.closedPnl || '0') < 0)
    const avgLoss = losingCloses.length > 0
      ? Math.abs(losingCloses.reduce((s, f) => s + parseFloat(f.closedPnl || '0'), 0) / losingCloses.length)
      : 1
    const winLossRatio = avgLoss > 0 ? avgWin / avgLoss : 0

    let exitStyle: string
    if (winLossRatio > 2) {
      exitStyle = 'Lets winners run — average win is significantly larger than average loss'
    } else if (winLossRatio > 1) {
      exitStyle = 'Balanced exits — takes profits at moderate targets with disciplined stops'
    } else {
      exitStyle = 'Tight risk management — cuts losses quickly, relies on high win rate'
    }

    return {
      topAssets,
      avgHoldSeconds,
      avgSize,
      maxSize,
      sizingPattern,
      marketCondition,
      exitStyle,
      longPct,
      avgLeverage,
      maxWinStreak,
      maxLossStreak,
      peakHour,
      peakHourEnd,
      winLossRatio,
    }
  }, [fills, state])

  if (!insights) {
    return (
      <div className="card p-6 text-center">
        <p className="text-white/55 text-sm">Not enough trade data to generate a strategy summary.</p>
      </div>
    )
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Target size={16} className="text-[#34EAB9]" />
          <h3 className="font-semibold text-sm">Strategy Scouting Report</h3>
        </div>

        {/* Narrative summary */}
        <div className="bg-[#0F1A1E] rounded-lg p-4 mb-4 border-l-2 border-l-[#34EAB9]">
          <p className="text-sm text-[#F0FAF8] leading-relaxed">
            This <span className="text-[#34EAB9] font-medium">{analytics.archetype}</span> trader
            focuses primarily on{' '}
            <span className="font-medium">{insights.topAssets.slice(0, 3).map(a => a.coin).join(', ')}</span>.
            {' '}They hold positions for an average of{' '}
            <span className="font-mono font-medium">{formatDuration(insights.avgHoldSeconds)}</span>,
            {' '}running <span className="font-mono font-medium">{insights.avgLeverage.toFixed(1)}x</span> leverage
            {' '}with a <span className="font-mono font-medium">{insights.longPct}%</span> long bias.
            {' '}{insights.sizingPattern}.
            {' '}{insights.exitStyle}.
          </p>
        </div>

        {/* Key behavior metrics */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
          <div className="bg-[#0F1A1E] rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Clock size={12} className="text-white/40" />
              <span className="text-[10px] text-white/40">Avg Hold</span>
            </div>
            <p className="font-mono font-semibold text-sm">{formatDuration(insights.avgHoldSeconds)}</p>
          </div>
          <div className="bg-[#0F1A1E] rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <BarChart3 size={12} className="text-white/40" />
              <span className="text-[10px] text-white/40">Avg Size</span>
            </div>
            <p className="font-mono font-semibold text-sm">{formatUsd(insights.avgSize)}</p>
          </div>
          <div className="bg-[#0F1A1E] rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingUp size={12} className="text-white/40" />
              <span className="text-[10px] text-white/40">W/L Ratio</span>
            </div>
            <p className="font-mono font-semibold text-sm">{insights.winLossRatio.toFixed(2)}x</p>
          </div>
          <div className="bg-[#0F1A1E] rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Shield size={12} className="text-white/40" />
              <span className="text-[10px] text-white/40">Max Streak</span>
            </div>
            <p className="font-mono font-semibold text-sm">
              <span className="text-[#34EAB9]">{insights.maxWinStreak}W</span>
              {' / '}
              <span className="text-[#FF3B5C]">{insights.maxLossStreak}L</span>
            </p>
          </div>
        </div>

        {/* Top traded assets */}
        <div className="mb-4">
          <p className="text-xs text-white/40 uppercase tracking-wider mb-2">Focus Assets</p>
          <div className="space-y-1.5">
            {insights.topAssets.map(asset => {
              const pct = Math.round((asset.count / fills.length) * 100)
              return (
                <div key={asset.coin} className="flex items-center gap-3">
                  <span className="text-xs font-semibold w-12 shrink-0">{asset.coin}</span>
                  <div className="flex-1 h-5 bg-[#0F1A1E] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#34EAB9] rounded-full opacity-50"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="font-mono text-[10px] text-white/55 w-8 text-right">{pct}%</span>
                  <span className={`font-mono text-[10px] w-16 text-right ${asset.pnl >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                    {asset.pnl >= 0 ? '+' : '-'}{formatUsd(asset.pnl)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Behavioral insights */}
        <div className="space-y-3">
          <p className="text-xs text-white/40 uppercase tracking-wider">Behavioral Insights</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="bg-[#0F1A1E] rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Zap size={12} className="text-[#34EAB9]" />
                <span className="text-[10px] text-white/40">Market Preference</span>
              </div>
              <p className="text-xs text-[#F0FAF8] leading-relaxed">{insights.marketCondition}</p>
            </div>
            <div className="bg-[#0F1A1E] rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Clock size={12} className="text-[#34EAB9]" />
                <span className="text-[10px] text-white/40">Peak Activity</span>
              </div>
              <p className="text-xs text-[#F0FAF8]">
                Most active {insights.peakHour.toString().padStart(2, '0')}:00 – {insights.peakHourEnd.toString().padStart(2, '0')}:00 UTC
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <Link
          href={`/copy-trade?target=${address}`}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded text-sm font-semibold bg-[#34EAB9] text-[#0F1A1E] hover:brightness-110 transition-all"
        >
          <Copy size={14} />
          Copy This Trader
        </Link>
        <Link
          href={`/alerts?wallet=${address}`}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded text-sm font-medium border border-white/[0.12] text-white/55 hover:border-[#34EAB9] hover:text-[#34EAB9] transition-colors"
        >
          <Zap size={14} />
          Set Alert
        </Link>
      </div>
    </motion.div>
  )
}
