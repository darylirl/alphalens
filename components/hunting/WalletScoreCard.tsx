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
        <Metric label="Sharpe 7d" value={sharpe7d.toFixed(2)} />
        <Metric label="Sharpe 30d" value={sharpe30d.toFixed(2)} />
        <Metric label="Sharpe 90d" value={sharpe90d.toFixed(2)} />
        <Metric label="Win Rate" value={`${(winRate * 100).toFixed(0)}%`} />
        <Metric label="Alpha Decay" value={alphaDecay.toFixed(2)} />
        <Metric label="Max Drawdown" value={`$${Math.abs(maxDrawdown).toLocaleString()}`} />
        <Metric label="Trade Count" value={tradeCount.toString()} />
      </div>
    </motion.div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#072724] rounded p-2.5">
      <p className="text-[#8AADA9] text-xs mb-0.5">{label}</p>
      <p className="font-mono font-semibold text-sm">{value}</p>
    </div>
  )
}
