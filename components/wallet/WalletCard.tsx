'use client'
import { useState } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { Copy, Check } from 'lucide-react'
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
  const [copied, setCopied] = useState(false)
  const shortAddr = truncateAddress(address)
  const alias = getWalletAlias(address)
  const displayName = alias || label || shortAddr
  const pnlPositive = totalPnl >= 0

  const copyAddress = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    await navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }}>
      <Link href={`/wallet/${address}`}>
        <div className="card p-4 active:scale-[0.98] transition-all cursor-pointer hover:bg-white/[0.06]">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              {rank && (
                <span className="text-white/40 text-sm font-mono w-6">#{rank}</span>
              )}
              <div className="flex items-center gap-1.5">
                <div>
                  <p className="font-medium text-sm text-[#F0FAF8]">{displayName}</p>
                  {(alias || label) && <p className="text-white/40 text-xs font-mono">{shortAddr}</p>}
                </div>
                <button
                  onClick={copyAddress}
                  className="text-white/20 hover:text-white/60 transition-colors shrink-0 p-0.5"
                  title="Copy full address"
                >
                  {copied ? <Check size={12} className="text-[#34EAB9]" /> : <Copy size={12} />}
                </button>
              </div>
            </div>
            <ArchetypeBadge type={archetype} />
          </div>

          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <p className="text-white/40 text-[11px] mb-1">30d PnL</p>
              <p className={`font-semibold text-sm font-mono ${pnlPositive ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                {pnlPositive ? '+' : '-'}${Math.abs(totalPnl).toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-white/40 text-[11px] mb-1">Win Rate</p>
              <p className="font-semibold text-sm font-mono text-[#F0FAF8]">{(winRate * 100).toFixed(0)}%</p>
            </div>
            <div>
              <p className="text-white/40 text-[11px] mb-1">Sharpe</p>
              <p className={`font-semibold text-sm font-mono ${isNaN(sharpe30d) ? 'text-[#F0FAF8]' : sharpe30d >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>{isNaN(sharpe30d) ? '—' : `${sharpe30d >= 0 ? '+' : ''}${sharpe30d.toFixed(2)}`}</p>
            </div>
          </div>

          <AlphaDecayMeter score={alphaDecay} />
        </div>
      </Link>
    </motion.div>
  )
}
