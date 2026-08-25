'use client'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { Users, ArrowUpRight, ArrowDownRight, ExternalLink, Zap } from 'lucide-react'

// Matches the `consensus` array in the /api/signals response exactly:
// groups of 3+ tracked wallets signalling the same coin+side within an hour.
export interface ConsensusAlert {
  coin: string
  side: 'long' | 'short'
  wallet_count: number
  total_notional: number
  avg_confidence: 'high' | 'medium'
  wallets: string[]
}

function formatUsd(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `$${(abs / 1e3).toFixed(0)}K`
  return `$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

export function ConsensusAlerts({ alerts }: { alerts: ConsensusAlert[] }) {
  if (alerts.length === 0) {
    return (
      <div className="card p-6 text-center">
        <Users size={24} className="mx-auto mb-3 text-white/40" />
        <p className="text-white/55 text-sm mb-1">No consensus alerts</p>
        <p className="text-white/40 text-xs">
          Fires when 3+ tracked wallets signal the same coin and direction
          within a 1-hour window
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {alerts.map((alert, i) => {
        const isLong = alert.side === 'long'
        return (
          <motion.div
            key={`${alert.coin}_${alert.side}`}
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
                    <span className="text-lg font-bold">{alert.coin}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isLong ? 'bg-[#34EAB920] text-[#34EAB9]' : 'bg-[#FF3B5C20] text-[#FF3B5C]'}`}>
                      {alert.side.toUpperCase()} CONSENSUS
                    </span>
                  </div>
                  <p className="text-[10px] text-white/40 mt-0.5">
                    {alert.wallet_count} wallets within the last hour &middot; avg confidence {alert.avg_confidence}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-mono text-sm font-bold">{formatUsd(Number(alert.total_notional))}</p>
                <p className="text-[10px] text-white/40">Combined notional</p>
              </div>
            </div>

            {/* Participating wallets — addresses only, from real signals */}
            <div className="bg-[#0F1A1E] rounded-lg p-3 mb-3">
              <p className="text-[10px] text-white/40 uppercase tracking-wider mb-2">Participating Wallets</p>
              <div className="flex flex-wrap gap-2">
                {alert.wallets.map(address => (
                  <Link
                    key={address}
                    href={`/wallet/${address}`}
                    className="font-mono text-[10px] text-white/55 hover:text-[#34EAB9] transition-colors bg-white/[0.04] px-2 py-1 rounded"
                  >
                    {address.slice(0, 6)}…{address.slice(-4)}
                  </Link>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <a
                href={`https://app.hyperliquid.xyz/trade/${alert.coin}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded text-xs font-semibold bg-[#34EAB9] text-[#0F1A1E] hover:brightness-110 transition-all"
              >
                {isLong ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                View {alert.coin} market
              </a>
              <Link
                href="/pulse"
                className="flex items-center justify-center gap-1 py-2 px-3 rounded text-xs text-white/55 border border-white/[0.12] hover:border-[#34EAB9] transition-colors"
              >
                <ExternalLink size={10} />
                Cohort view
              </Link>
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}
