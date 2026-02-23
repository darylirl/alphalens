'use client'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { Users, ArrowUpRight, ArrowDownRight, ExternalLink, Zap } from 'lucide-react'

export interface ConsensusAlert {
  id: string
  asset: string
  direction: 'Long' | 'Short'
  walletCount: number
  wallets: Array<{
    address: string
    label?: string
    pnl30d: number
    winRate: number
    size: number
  }>
  totalSize: number
  avgConfidence: number
  triggeredAt: number
  windowMinutes: number
}

function formatUsd(n: number): string {
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function ConsensusAlerts({ alerts }: { alerts: ConsensusAlert[] }) {
  if (alerts.length === 0) {
    return (
      <div className="card p-6 text-center">
        <Users size={24} className="mx-auto mb-3 text-white/40" />
        <p className="text-white/55 text-sm mb-1">No consensus alerts</p>
        <p className="text-white/40 text-xs">
          Fires when 3+ high-conviction wallets take similar positions within a 1-hour window
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {alerts.map((alert, i) => {
        const isLong = alert.direction === 'Long'
        return (
          <motion.div
            key={alert.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="card p-4 border-l-2"
            style={{ borderLeftColor: isLong ? '#34EAB9' : '#FF3B5C' }}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className={`p-1.5 rounded-lg ${isLong ? 'bg-[#34EAB920]' : 'bg-[#FF3B5C20]'}`}>
                  <Zap size={14} className={isLong ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold">{alert.asset}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isLong ? 'bg-[#34EAB920] text-[#34EAB9]' : 'bg-[#FF3B5C20] text-[#FF3B5C]'}`}>
                      {alert.direction.toUpperCase()} CONSENSUS
                    </span>
                  </div>
                  <p className="text-[10px] text-white/40 mt-0.5">
                    {alert.walletCount} wallets within {alert.windowMinutes}min window &middot; {timeAgo(alert.triggeredAt)}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-mono text-sm font-bold">{formatUsd(alert.totalSize)}</p>
                <p className="text-[10px] text-white/40">Combined size</p>
              </div>
            </div>

            {/* Participating wallets */}
            <div className="bg-[#0F1A1E] rounded-lg p-3 mb-3">
              <p className="text-[10px] text-white/40 uppercase tracking-wider mb-2">Participating Wallets</p>
              <div className="space-y-1.5">
                {alert.wallets.map(w => {
                  const shortAddr = `${w.address.slice(0, 6)}...${w.address.slice(-4)}`
                  return (
                    <div key={w.address} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <Link href={`/wallet/${w.address}`} className="font-mono text-white/55 hover:text-[#34EAB9] transition-colors">
                          {w.label || shortAddr}
                        </Link>
                        <span className="text-[9px] text-white/40">
                          {(w.winRate * 100).toFixed(0)}% win
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`font-mono text-[10px] ${w.pnl30d >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                          {w.pnl30d >= 0 ? '+' : ''}{formatUsd(w.pnl30d)}
                        </span>
                        <span className="font-mono text-[10px] text-white/55">{formatUsd(w.size)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              <a
                href={`https://app.hyperliquid.xyz/trade/${alert.asset}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded text-xs font-semibold bg-[#34EAB9] text-[#0F1A1E] hover:brightness-110 transition-all"
              >
                {isLong ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                Trade {alert.asset}
              </a>
              <Link
                href={`/smart-money`}
                className="flex items-center justify-center gap-1 py-2 px-3 rounded text-xs text-white/55 border border-white/[0.12] hover:border-[#34EAB9] transition-colors"
              >
                <ExternalLink size={10} />
                Details
              </Link>
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}
