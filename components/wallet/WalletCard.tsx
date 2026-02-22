'use client'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { ArchetypeBadge } from './ArchetypeBadge'
import { AlphaDecayMeter } from './AlphaDecayMeter'

interface WalletCardProps {
  address: string
  label?: string
  archetype: string
  sharpe30d: number
  winRate: number
  totalPnl: number
  alphaDecay: number
  rank?: number
}

export function WalletCard({ address, label, archetype, sharpe30d, winRate, totalPnl, alphaDecay, rank }: WalletCardProps) {
  const shortAddr = `${address.slice(0, 6)}...${address.slice(-4)}`
  const pnlPositive = totalPnl >= 0

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <Link href={`/wallet/${address}`}>
        <div className="card p-4 active:scale-[0.98] transition-transform cursor-pointer hover:border-[#333333]">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              {rank && (
                <span className="text-[#888888] text-sm font-mono w-6">#{rank}</span>
              )}
              <div>
                <p className="font-semibold text-sm">{label || shortAddr}</p>
                {label && <p className="text-[#888888] text-xs font-mono">{shortAddr}</p>}
              </div>
            </div>
            <ArchetypeBadge type={archetype} />
          </div>

          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <p className="text-[#888888] text-xs mb-1">30d PnL</p>
              <p className={`font-semibold text-sm ${pnlPositive ? 'text-[#00ff88]' : 'text-[#ff3b3b]'}`}>
                {pnlPositive ? '+' : ''}${Math.abs(totalPnl).toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-[#888888] text-xs mb-1">Win Rate</p>
              <p className="font-semibold text-sm">{(winRate * 100).toFixed(0)}%</p>
            </div>
            <div>
              <p className="text-[#888888] text-xs mb-1">Sharpe</p>
              <p className="font-semibold text-sm">{sharpe30d.toFixed(2)}</p>
            </div>
          </div>

          <AlphaDecayMeter score={alphaDecay} />
        </div>
      </Link>
    </motion.div>
  )
}
