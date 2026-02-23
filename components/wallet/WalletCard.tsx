'use client'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { ArchetypeBadge } from './ArchetypeBadge'
import { AlphaDecayMeter } from './AlphaDecayMeter'
import { getWalletAlias, truncateAddress } from '@/lib/walletAliases'

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
  const shortAddr = truncateAddress(address)
  const alias = getWalletAlias(address)
  const displayName = alias || label || shortAddr
  const pnlPositive = totalPnl >= 0

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }}>
      <Link href={`/wallet/${address}`}>
        <div className="card p-4 active:scale-[0.98] transition-all cursor-pointer hover:bg-white/[0.06]">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              {rank && (
                <span className="text-white/40 text-sm font-mono w-6">#{rank}</span>
              )}
              <div>
                <p className="font-medium text-sm text-[#F0FAF8]">{displayName}</p>
                {(alias || label) && <p className="text-white/40 text-xs font-mono">{shortAddr}</p>}
              </div>
            </div>
            <ArchetypeBadge type={archetype} />
          </div>

          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <p className="text-white/40 text-[11px] mb-1">30d PnL</p>
              <p className={`font-semibold text-sm font-mono ${pnlPositive ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                {pnlPositive ? '+' : ''}${Math.abs(totalPnl).toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-white/40 text-[11px] mb-1">Win Rate</p>
              <p className="font-semibold text-sm font-mono text-[#F0FAF8]">{(winRate * 100).toFixed(0)}%</p>
            </div>
            <div>
              <p className="text-white/40 text-[11px] mb-1">Sharpe</p>
              <p className="font-semibold text-sm font-mono text-[#F0FAF8]">{isNaN(sharpe30d) ? '—' : sharpe30d.toFixed(2)}</p>
            </div>
          </div>

          <AlphaDecayMeter score={alphaDecay} />
        </div>
      </Link>
    </motion.div>
  )
}
