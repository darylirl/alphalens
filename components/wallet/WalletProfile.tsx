'use client'
import { motion } from 'framer-motion'
import { ArchetypeBadge } from './ArchetypeBadge'
import { AlphaDecayMeter } from './AlphaDecayMeter'
import { PositionTable } from './PositionTable'
import { PositionHeatmap } from './PositionHeatmap'
import { PnLChart } from './PnLChart'
import { TokenMetrics } from './TokenMetrics'
import type { WalletDetail } from '@/lib/hyperliquid/types'
import type { DailyPnl } from '@/lib/analytics/pnl'

interface WalletProfileProps {
  detail: WalletDetail
  analytics: {
    archetype: string
    confidence: number
    sharpe7d: number
    sharpe30d: number
    sharpe90d: number
    winRate: number
    totalPnl: number
    alphaDecay: number
    maxDrawdown: number
    tradeCount: number
  }
  dailyPnl: DailyPnl[]
}

export function WalletProfile({ detail, analytics, dailyPnl }: WalletProfileProps) {
  const shortAddr = `${detail.address.slice(0, 6)}...${detail.address.slice(-4)}`
  const accountValue = parseFloat(detail.state.crossMarginSummary?.accountValue || '0')

  return (
    <div className="space-y-4">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="card p-4">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="font-mono text-sm text-[#8AADA9] mb-1">{shortAddr}</p>
            <p className="font-mono text-2xl font-bold">${accountValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
            <p className="text-xs text-[#8AADA9] mt-1">Account Value</p>
          </div>
          <ArchetypeBadge type={analytics.archetype} />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricBox label="Total PnL" value={`$${analytics.totalPnl.toLocaleString()}`} positive={analytics.totalPnl >= 0} />
          <MetricBox label="Win Rate" value={`${(analytics.winRate * 100).toFixed(0)}%`} />
          <MetricBox label="Sharpe (30d)" value={analytics.sharpe30d.toFixed(2)} />
          <MetricBox label="Max DD" value={`$${Math.abs(analytics.maxDrawdown).toLocaleString()}`} positive={false} />
        </div>
      </motion.div>

      <div className="grid grid-cols-3 gap-3">
        <div className="card p-3 text-center">
          <p className="text-xs text-[#8AADA9] mb-1">Sharpe 7d</p>
          <p className="font-mono font-semibold">{analytics.sharpe7d.toFixed(2)}</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-xs text-[#8AADA9] mb-1">Sharpe 90d</p>
          <p className="font-mono font-semibold">{analytics.sharpe90d.toFixed(2)}</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-xs text-[#8AADA9] mb-1">Trades</p>
          <p className="font-mono font-semibold">{analytics.tradeCount}</p>
        </div>
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="card p-4">
        <h3 className="text-sm font-semibold mb-1">Alpha Decay</h3>
        <AlphaDecayMeter score={analytics.alphaDecay} />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="card p-4">
        <h3 className="text-sm font-semibold mb-3">Cumulative PnL</h3>
        <PnLChart data={dailyPnl} />
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
        <TokenMetrics fills={detail.fills} />
      </motion.div>
    </div>
  )
}

function MetricBox({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  const colorClass = positive === undefined ? '' : positive ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'
  return (
    <div className="bg-[#072724] rounded p-3">
      <p className="text-[#8AADA9] text-xs mb-1">{label}</p>
      <p className={`font-mono font-semibold text-sm ${colorClass}`}>{value}</p>
    </div>
  )
}
