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
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }}>
      <Link href={`/wallet/${address}`}>
        <div className="card p-4 active:scale-[0.98] transition-all cursor-pointer hover:bg-[#0F3D38]">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              {rank && (
                <span className="text-[#4A706C] text-sm font-mono w-6">#{rank}</span>
              )}
              <div>
                <p className="font-medium text-sm text-[#F0FAF8]">{label || shortAddr}</p>
                {label && <p className="text-[#4A706C] text-xs font-mono">{shortAddr}</p>}
              </div>
            </div>
            <ArchetypeBadge type={archetype} />
          </div>

          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <p className="text-[#4A706C] text-[11px] mb-1">30d PnL</p>
              <p className={`font-semibold text-sm font-mono ${pnlPositive ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                {pnlPositive ? '+' : ''}${Math.abs(totalPnl).toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-[#4A706C] text-[11px] mb-1">Win Rate</p>
              <p className="font-semibold text-sm font-mono text-[#F0FAF8]">{(winRate * 100).toFixed(0)}%</p>
            </div>
            <div>
              <p className="text-[#4A706C] text-[11px] mb-1">Sharpe</p>
              <p className="font-semibold text-sm font-mono text-[#F0FAF8]">{sharpe30d.toFixed(2)}</p>
            </div>
          </div>

          <AlphaDecayMeter score={alphaDecay} />
        </div>
      </Link>
    </motion.div>
  )
}
