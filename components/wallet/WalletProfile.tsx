'use client'
import { motion } from 'framer-motion'
import { ArchetypeBadge } from './ArchetypeBadge'
import { AlphaDecayMeter } from './AlphaDecayMeter'
import { PositionTable } from './PositionTable'
import { PositionHeatmap } from './PositionHeatmap'
import { PnLChart } from './PnLChart'
import { TokenMetrics } from './TokenMetrics'
import { StrategySummary } from './StrategySummary'
import type { WalletDetail, ClearinghouseState } from '@/lib/hyperliquid/types'
import { computeDailyPnl, computeSharpe, computeSharpeFromFills, computeWinRate, computeMaxDrawdown } from '@/lib/analytics/pnl'
import { detectArchetype } from '@/lib/analytics/archetype'
import { computeAlphaDecay } from '@/lib/analytics/alphaDecay'
import { getWalletAlias, truncateAddress } from '@/lib/walletAliases'

interface WalletProfileProps {
  detail: WalletDetail
  headlinePnl: number
}

export function WalletProfile({ detail, headlinePnl }: WalletProfileProps) {
  const shortAddr = truncateAddress(detail.address)
  const alias = getWalletAlias(detail.address)
  const accountValue = parseFloat(detail.state.crossMarginSummary?.accountValue || '0')

  const fills = detail.fills || []
  const state = detail.state as ClearinghouseState

  const dailyPnl = computeDailyPnl(fills)
  const dailyValues = dailyPnl.map(d => d.pnl)
  const archetypeResult = detectArchetype(fills, state)

  function sharpeOrFallback(days: number): number {
    const daily = computeSharpe(dailyValues.slice(-days))
    if (!isNaN(daily)) return daily
    return computeSharpeFromFills(fills, days)
  }

  const analytics = {
    archetype: archetypeResult.archetype,
    confidence: archetypeResult.confidence,
    sharpe7d: sharpeOrFallback(7),
    sharpe30d: sharpeOrFallback(30),
    sharpe90d: sharpeOrFallback(90),
    winRate: computeWinRate(fills),
    totalPnl: headlinePnl,
    alphaDecay: computeAlphaDecay(fills),
    maxDrawdown: computeMaxDrawdown(dailyValues),
    tradeCount: fills.length
  }

  return (
    <div className="space-y-4">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="card p-4">
        <div className="flex items-start justify-between mb-4">
          <div>
            {alias ? (
              <>
                <p className="text-lg font-semibold text-[#F0FAF8] mb-0.5">{alias}</p>
                <p className="font-mono text-xs text-white/40 mb-1">{shortAddr}</p>
              </>
            ) : (
              <p className="font-mono text-sm text-white/55 mb-1">{shortAddr}</p>
            )}
            <p className="font-mono text-2xl font-bold">${accountValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
            <p className="text-xs text-white/55 mt-1">Account Value</p>
          </div>
          <ArchetypeBadge type={analytics.archetype} />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricBox label="All-Time PnL" value={`${analytics.totalPnl >= 0 ? '+' : '-'}$${Math.abs(analytics.totalPnl).toLocaleString()}`} positive={analytics.totalPnl >= 0} />
          <MetricBox label="Win Rate" value={`${(analytics.winRate * 100).toFixed(0)}%`} />
          <MetricBox label="Sharpe (30d)" value={isNaN(analytics.sharpe30d) ? '—' : `${analytics.sharpe30d >= 0 ? '+' : ''}${analytics.sharpe30d.toFixed(2)}`} positive={isNaN(analytics.sharpe30d) ? undefined : analytics.sharpe30d >= 0} />
          <MetricBox label="Max DD" value={analytics.maxDrawdown === 0 ? '$0' : `-$${Math.abs(analytics.maxDrawdown).toLocaleString()}`} positive={analytics.maxDrawdown === 0 ? undefined : false} />
        </div>
      </motion.div>

      <div className="grid grid-cols-3 gap-3">
        <div className="card p-3 text-center">
          <p className="text-xs text-white/55 mb-1">Sharpe 7d</p>
          <p className={`font-mono font-semibold ${isNaN(analytics.sharpe7d) ? 'text-white/55' : analytics.sharpe7d >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>{isNaN(analytics.sharpe7d) ? '—' : `${analytics.sharpe7d >= 0 ? '+' : ''}${analytics.sharpe7d.toFixed(2)}`}</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-xs text-white/55 mb-1">Sharpe 90d</p>
          <p className={`font-mono font-semibold ${isNaN(analytics.sharpe90d) ? 'text-white/55' : analytics.sharpe90d >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>{isNaN(analytics.sharpe90d) ? '—' : `${analytics.sharpe90d >= 0 ? '+' : ''}${analytics.sharpe90d.toFixed(2)}`}</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-xs text-white/55 mb-1">Trades</p>
          <p className="font-mono font-semibold">{analytics.tradeCount}</p>
        </div>
      </div>

      <StrategySummary
        fills={fills}
        state={state}
        address={detail.address}
        analytics={analytics}
      />

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="card p-4">
        <h3 className="text-sm font-semibold mb-1">Alpha Decay</h3>
        <AlphaDecayMeter score={analytics.alphaDecay} />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="card p-4">
        <h3 className="text-sm font-semibold mb-3">Cumulative PnL</h3>
        <PnLChart portfolio={detail.portfolio} />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="card p-4">
        <h3 className="text-sm font-semibold mb-3">Position Heatmap</h3>
        <PositionHeatmap positions={detail.state.assetPositions} />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="card p-4">
        <h3 className="text-sm font-semibold mb-3">Open Positions</h3>
        <PositionTable positions={detail.state.assetPositions} />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="card p-4">
        <h3 className="text-sm font-semibold mb-3">Token Metrics</h3>
        <TokenMetrics fills={fills} />
      </motion.div>
    </div>
  )
}

function MetricBox({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  const colorClass = positive === undefined ? '' : positive ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'
  return (
    <div className="bg-[#0F1A1E] rounded p-3">
      <p className="text-white/55 text-xs mb-1">{label}</p>
      <p className={`font-mono font-semibold text-sm ${colorClass}`}>{value}</p>
    </div>
  )
}
