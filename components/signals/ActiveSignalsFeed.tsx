'use client'
import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { Activity, ArrowUpRight, ArrowDownRight, Plus, Minus, LogOut, Copy, ExternalLink, Clock, Filter, Info } from 'lucide-react'

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

const featuredSignals: Signal[] = [
  {
    id: 'featured-1',
    walletAddress: '0x7a23e91f',
    walletLabel: 'Momentum Trader',
    action: 'new_position',
    side: 'Long',
    asset: 'ETH',
    size: 75000,
    price: 3510,
    leverage: 5,
    winRate: 0.71,
    pnl30d: 284291,
    timestamp: Date.now() - 4 * 60 * 1000,
  },
  {
    id: 'featured-2',
    walletAddress: '0x348e50ef',
    walletLabel: 'Momentum Trader',
    action: 'new_position',
    side: 'Long',
    asset: 'HYPE',
    size: 42000,
    price: 27.80,
    leverage: 3,
    winRate: 0.49,
    pnl30d: 834134,
    timestamp: Date.now() - 11 * 60 * 1000,
  },
  {
    id: 'featured-3',
    walletAddress: '0xa33a1ff8',
    walletLabel: 'Scalper',
    action: 'new_position',
    side: 'Short',
    asset: 'XRP',
    size: 28000,
    price: 1.354,
    leverage: 10,
    winRate: 0.50,
    pnl30d: 148442,
    timestamp: Date.now() - 18 * 60 * 1000,
  },
]

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
  const abs = Math.abs(n)
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `$${(abs / 1e3).toFixed(0)}K`
  return `$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
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
      <div className="space-y-3">
        {/* Info banner */}
        <div className="flex items-start gap-2 bg-[#34EAB9]/[0.06] border border-[#34EAB9]/[0.12] rounded-lg px-3 py-2.5">
          <Info size={14} className="text-[#34EAB9] flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-white/55 leading-relaxed">
            You&apos;re not tracking any wallets yet. These are live signals from our top performers.
          </p>
        </div>

        {/* Featured signal cards */}
        {featuredSignals.map((signal) => {
          const isLong = signal.side === 'Long'
          const shortAddr = `${signal.walletAddress.slice(0, 6)}...${signal.walletAddress.slice(-4)}`

          return (
            <div key={signal.id} className="card p-3">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="p-1 rounded bg-[#34EAB920]">
                    <div className="w-2 h-2 rounded-full bg-[#34EAB9]" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded text-[#34EAB9] bg-[#34EAB915]">
                        New Position
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="font-mono text-[10px] text-white/55">{shortAddr}</span>
                      <span className="text-[9px] text-white/40">· {signal.walletLabel}</span>
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="flex items-center gap-1 justify-end">
                    <Clock size={8} className="text-white/40" />
                    <span className="text-[9px] text-white/40">{timeAgo(signal.timestamp)}</span>
                  </div>
                </div>
              </div>

              <div className="bg-[#0F1A1E] rounded px-3 py-2 mb-2 border border-white/[0.04]">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-semibold ${isLong ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                    {isLong ? 'Opened Long' : 'Opened Short'}
                  </span>
                  <span className="text-sm font-bold">{signal.asset}</span>
                  <span className="text-[10px] text-white/40">·</span>
                  <span className="font-mono text-[10px] text-white/55">{formatUsd(signal.size)}</span>
                  <span className="text-[10px] text-white/40">·</span>
                  <span className="font-mono text-[10px] text-white/55">{signal.leverage}x</span>
                  <span className="text-[10px] text-white/40">·</span>
                  <span className="font-mono text-[10px] text-white/55">Entry ${signal.price.toLocaleString()}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Link
                  href={`/copy-trade?target=${signal.walletAddress}`}
                  className="flex items-center gap-1 text-[10px] font-semibold bg-[#34EAB9] text-[#0F1A1E] px-3 py-1.5 rounded hover:brightness-110 transition-all"
                >
                  <Copy size={10} />
                  Mirror Trade
                </Link>
                <Link
                  href={`/wallet/${signal.walletAddress}`}
                  className="flex items-center gap-1 text-[10px] font-semibold border border-white/[0.12] text-white/55 px-3 py-1.5 rounded hover:border-white/[0.24] transition-all"
                >
                  Follow Wallet
                </Link>
              </div>
            </div>
          )
        })}

        <p className="text-center text-[11px] text-white/40 pt-1">
          <Link href="/hunters" className="text-[#34EAB9] hover:underline">
            Track wallets from the Explorer
          </Link>{' '}
          to see their real moves here →
        </p>
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
                          {signal.pnl30d >= 0 ? '+' : '-'}{formatUsd(signal.pnl30d)} 30d
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
