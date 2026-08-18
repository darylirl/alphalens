'use client'
import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { ExternalLink, Clock, TrendingUp, Crosshair } from 'lucide-react'

// Matches the /api/signals row shape (Supabase `signals` table) exactly.
// Signals are generated from real $50K+ fills by tracked wallets; nothing
// here is ever fabricated — an empty feed renders an honest empty state.
export interface Signal {
  signal_id: string
  wallet_address: string
  wallet_label: string | null
  wallet_tags?: string[]
  coin: string
  side: 'long' | 'short'
  entry_price: number
  notional_usd: number
  confidence: 'high' | 'medium' | 'low'
  timestamp: string
  expires_at: string
}

const CONFIDENCE_STYLES: Record<string, string> = {
  high: 'bg-[#34EAB9]/15 text-[#34EAB9]',
  medium: 'bg-amber-400/15 text-amber-400',
  low: 'bg-white/[0.08] text-white/55',
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
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
  const [filter, setFilter] = useState<'all' | 'long' | 'short'>('all')

  const filtered = useMemo(() => {
    if (filter === 'all') return signals
    return signals.filter(s => s.side === filter)
  }, [signals, filter])

  if (signals.length === 0) {
    // Honest empty state: no demo data, ever. Point at real live surfaces.
    return (
      <div className="card p-5">
        <p className="text-sm font-semibold mb-1">No active signals right now</p>
        <p className="text-white/40 text-xs mb-4">
          Signals appear when tracked wallets open positions above $50,000
          notional. Until then, see what the cohort is actually doing.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Link
            href="/pulse"
            className="flex items-center gap-2 bg-[#0F1A1E] rounded p-3 hover:bg-white/[0.06] transition-colors"
          >
            <TrendingUp size={16} className="text-[#34EAB9] shrink-0" />
            <div>
              <p className="text-xs font-semibold">Pulse</p>
              <p className="text-[10px] text-white/40">See what tracked wallets are actually doing</p>
            </div>
          </Link>
          <Link
            href="/hunters"
            className="flex items-center gap-2 bg-[#0F1A1E] rounded p-3 hover:bg-white/[0.06] transition-colors"
          >
            <Crosshair size={16} className="text-[#34EAB9] shrink-0" />
            <div>
              <p className="text-xs font-semibold">Explorer</p>
              <p className="text-[10px] text-white/40">Browse classified wallets</p>
            </div>
          </Link>
        </div>
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
            {(['all', 'long', 'short'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-[10px] px-2 py-1 rounded-full transition-colors capitalize ${
                  filter === f ? 'bg-[#34EAB9] text-[#0F1A1E]' : 'bg-[#0F1A1E] text-white/55'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={`space-y-2 ${compact ? 'max-h-[300px]' : 'max-h-[600px]'} overflow-y-auto scrollbar-none`}>
        <AnimatePresence mode="popLayout">
          {filtered.map((signal, i) => {
            const isLong = signal.side === 'long'
            const shortAddr = `${signal.wallet_address.slice(0, 6)}...${signal.wallet_address.slice(-4)}`

            return (
              <motion.div
                key={signal.signal_id}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ delay: i * 0.03 }}
                className="card p-3"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      isLong ? 'bg-[#34EAB9]/15 text-[#34EAB9]' : 'bg-[#FF3B5C]/15 text-[#FF3B5C]'
                    }`}>
                      {isLong ? 'LONG' : 'SHORT'}
                    </span>
                    <span className="text-sm font-bold">{signal.coin}</span>
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${CONFIDENCE_STYLES[signal.confidence]}`}>
                      {signal.confidence}
                    </span>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono text-xs font-semibold">{formatUsd(Number(signal.notional_usd))}</p>
                    <div className="flex items-center gap-1 justify-end mt-0.5">
                      <Clock size={8} className="text-white/40" />
                      <span className="text-[9px] text-white/40">{timeAgo(signal.timestamp)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-[10px] text-white/55">
                  <Link
                    href={`/wallet/${signal.wallet_address}`}
                    className="font-mono hover:text-[#34EAB9] transition-colors"
                  >
                    {signal.wallet_label || shortAddr}
                  </Link>
                  <span className="text-white/30">·</span>
                  <span className="font-mono">entry ${Number(signal.entry_price).toLocaleString()}</span>
                  <div className="flex-1" />
                  <a
                    href={`https://app.hyperliquid.xyz/trade/${signal.coin}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 hover:text-[#34EAB9] transition-colors"
                  >
                    <ExternalLink size={10} />
                    View market
                  </a>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}
