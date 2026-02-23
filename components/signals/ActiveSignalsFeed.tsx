'use client'
import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { Activity, ArrowUpRight, ArrowDownRight, Plus, Minus, LogOut, Copy, ExternalLink, Clock, Filter } from 'lucide-react'

export interface Signal {
  id: string
  walletAddress: string
  walletLabel?: string
  action: 'new_position' | 'add_to_position' | 'partial_exit' | 'full_exit'
  side: 'Long' | 'Short'
  asset: string
  size: number
  price: number
  leverage: number
  winRate: number
  pnl30d: number
  timestamp: number
}

const actionConfig = {
  new_position: { label: 'New Position', icon: ArrowUpRight, color: '#34EAB9', bg: 'bg-[#34EAB920]' },
  add_to_position: { label: 'Adding', icon: Plus, color: '#34EAB9', bg: 'bg-[#34EAB920]' },
  partial_exit: { label: 'Partial Exit', icon: Minus, color: '#FFB020', bg: 'bg-[#FFB02020]' },
  full_exit: { label: 'Closed', icon: LogOut, color: '#FF3B5C', bg: 'bg-[#FF3B5C20]' },
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function formatUsd(n: number): string {
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

interface ActiveSignalsFeedProps {
  signals: Signal[]
  compact?: boolean
}

export function ActiveSignalsFeed({ signals, compact = false }: ActiveSignalsFeedProps) {
  const [filter, setFilter] = useState<'all' | 'new_position' | 'add_to_position' | 'partial_exit' | 'full_exit'>('all')
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 10000)
    return () => clearInterval(interval)
  }, [])

  const filtered = useMemo(() => {
    if (filter === 'all') return signals
    return signals.filter(s => s.action === filter)
  }, [signals, filter])

  if (signals.length === 0) {
    return (
      <div className="card p-6 text-center">
        <Activity size={24} className="mx-auto mb-3 text-white/40" />
        <p className="text-white/55 text-sm mb-1">No active signals yet</p>
        <p className="text-white/40 text-xs">Signals appear when tracked wallets make moves</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {!compact && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#34EAB9] pulse-accent" />
            <span className="text-xs text-white/55">Live Signals</span>
          </div>
          <div className="flex gap-1">
            {(['all', 'new_position', 'add_to_position', 'partial_exit'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-[10px] px-2 py-1 rounded-full transition-colors ${
                  filter === f ? 'bg-[#34EAB9] text-[#0F1A1E]' : 'bg-[#0F1A1E] text-white/55'
                }`}
              >
                {f === 'all' ? 'All' : f === 'new_position' ? 'New' : f === 'add_to_position' ? 'Adding' : 'Exit'}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={`space-y-2 ${compact ? 'max-h-[300px]' : 'max-h-[600px]'} overflow-y-auto scrollbar-none`}>
        <AnimatePresence mode="popLayout">
          {filtered.map((signal, i) => {
            const config = actionConfig[signal.action]
            const Icon = config.icon
            const shortAddr = `${signal.walletAddress.slice(0, 6)}...${signal.walletAddress.slice(-4)}`
            const isLong = signal.side === 'Long'

            return (
              <motion.div
                key={signal.id}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ delay: i * 0.03 }}
                className="card p-3"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className={`p-1 rounded ${config.bg}`}>
                      <Icon size={12} style={{ color: config.color }} />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ color: config.color, background: config.color + '15' }}>
                          {config.label}
                        </span>
                        <span className={`text-[10px] font-semibold ${isLong ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                          {signal.side}
                        </span>
                        <span className="text-sm font-bold">{signal.asset}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Link href={`/wallet/${signal.walletAddress}`} className="font-mono text-[10px] text-white/55 hover:text-[#34EAB9] transition-colors">
                          {signal.walletLabel || shortAddr}
                        </Link>
                        <span className="text-[9px] text-white/40">
                          {(signal.winRate * 100).toFixed(0)}% win
                        </span>
                        <span className={`font-mono text-[9px] ${signal.pnl30d >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                          {signal.pnl30d >= 0 ? '+' : ''}{formatUsd(signal.pnl30d)} 30d
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono text-xs font-semibold">{formatUsd(signal.size)}</p>
                    <div className="flex items-center gap-1 justify-end mt-0.5">
                      <Clock size={8} className="text-white/40" />
                      <span className="text-[9px] text-white/40">{timeAgo(signal.timestamp)}</span>
                    </div>
                  </div>
                </div>

                {!compact && (
                  <div className="flex items-center gap-2 mt-2 pt-2 border-t border-white/[0.06]">
                    <span className="text-[9px] text-white/40">
                      @ ${signal.price.toLocaleString()} &middot; {signal.leverage}x
                    </span>
                    <div className="flex-1" />
                    <Link
                      href={`/copy-trade?target=${signal.walletAddress}`}
                      className="flex items-center gap-1 text-[10px] text-white/55 hover:text-[#34EAB9] transition-colors"
                    >
                      <Copy size={10} />
                      Copy
                    </Link>
                    <a
                      href={`https://app.hyperliquid.xyz/trade/${signal.asset}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[10px] text-white/55 hover:text-[#34EAB9] transition-colors"
                    >
                      <ExternalLink size={10} />
                      Trade
                    </a>
                  </div>
                )}
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}
