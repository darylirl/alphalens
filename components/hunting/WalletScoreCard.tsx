'use client'
import { motion } from 'framer-motion'

interface WalletScoreCardProps {
  sharpe7d: number
  sharpe30d: number
  sharpe90d: number
  winRate: number
  alphaDecay: number
  maxDrawdown: number
  tradeCount: number
}

export function WalletScoreCard({ sharpe7d, sharpe30d, sharpe90d, winRate, alphaDecay, maxDrawdown, tradeCount }: WalletScoreCardProps) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card p-4">
      <h3 className="text-sm font-semibold mb-3">Performance Metrics</h3>
      <div className="grid grid-cols-2 gap-3">
        <Metric label="Sharpe 7d" value={isNaN(sharpe7d) ? '—' : `${sharpe7d >= 0 ? '+' : ''}${sharpe7d.toFixed(2)}`} positive={isNaN(sharpe7d) ? undefined : sharpe7d >= 0} />
        <Metric label="Sharpe 30d" value={isNaN(sharpe30d) ? '—' : `${sharpe30d >= 0 ? '+' : ''}${sharpe30d.toFixed(2)}`} positive={isNaN(sharpe30d) ? undefined : sharpe30d >= 0} />
        <Metric label="Sharpe 90d" value={isNaN(sharpe90d) ? '—' : `${sharpe90d >= 0 ? '+' : ''}${sharpe90d.toFixed(2)}`} positive={isNaN(sharpe90d) ? undefined : sharpe90d >= 0} />
        <Metric label="Win Rate" value={`${(winRate * 100).toFixed(0)}%`} />
        <Metric label="Alpha Decay" value={alphaDecay.toFixed(2)} />
        <Metric label="Max Drawdown" value={`-$${Math.abs(maxDrawdown).toLocaleString()}`} positive={false} />
        <Metric label="Trade Count" value={tradeCount.toString()} />
      </div>
    </motion.div>
  )
}

function Metric({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  const colorClass = positive === undefined ? '' : positive ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'
  return (
    <div className="bg-[#0F1A1E] rounded p-2.5">
      <p className="text-white/55 text-xs mb-0.5">{label}</p>
      <p className={`font-mono font-semibold text-sm ${colorClass}`}>{value}</p>
    </div>
  )
}
