'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion } from 'framer-motion'
import { CopyableAddress } from '@/components/ui/CopyableAddress'
import { Activity, X, Users, Clock, TrendingUp, TrendingDown } from 'lucide-react'

interface Signal {
  signal_id: string
  wallet_address: string
  wallet_label: string | null
  coin: string
  side: 'long' | 'short'
  entry_price: number
  notional_usd: number
  confidence: 'high' | 'medium' | 'low'
  source: string
  status: string
  timestamp: string
  expires_at: string
}

interface ConsensusAlert {
  coin: string
  side: string
  wallet_count: number
  total_notional: number
  avg_confidence: string
  wallets: string[]
}

type SideFilter = 'all' | 'long' | 'short'
type ConfidenceFilter = 'all' | 'high' | 'medium' | 'low'

const POLL_INTERVAL = 30_000
const CONFIDENCE_COLORS: Record<string, string> = {
  high: 'bg-[#34EAB9]/15 text-[#34EAB9]',
  medium: 'bg-amber-500/15 text-amber-400',
  low: 'bg-white/[0.08] text-white/55',
}

function timeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function expiryCountdown(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now()
  if (diff <= 0) return 'expired'
  const hours = Math.floor(diff / 3600000)
  const mins = Math.floor((diff % 3600000) / 60000)
  if (hours > 0) return `${hours}h ${mins}m left`
  return `${mins}m left`
}

function formatUsd(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

export default function SignalsPage() {
  const [signals, setSignals] = useState<Signal[]>([])
  const [consensus, setConsensus] = useState<ConsensusAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [coinFilter, setCoinFilter] = useState('')
  const [sideFilter, setSideFilter] = useState<SideFilter>('all')
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>('all')

  const fetchSignals = useCallback(async () => {
    try {
      const res = await fetch('/api/signals?limit=50')
      if (!res.ok) return
      const json = await res.json()
      if (json.success) {
        setSignals(json.data || [])
        setConsensus(json.consensus || [])
      }
    } catch {
      // Silently fail on poll errors
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial fetch + polling
  useEffect(() => {
    fetchSignals()
    const interval = setInterval(fetchSignals, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchSignals])

  // Dismiss signal optimistically
  const dismissSignal = useCallback((signalId: string) => {
    setSignals(prev => prev.filter(s => s.signal_id !== signalId))
    fetch(`/api/signals/${signalId}/dismiss`, { method: 'POST' }).catch(() => {
      // If dismiss fails, signal is already removed from UI — acceptable for optimistic UX
    })
  }, [])

  // Get unique coins for filter dropdown
  const availableCoins = useMemo(() => {
    const coins = new Set(signals.map(s => s.coin))
    return Array.from(coins).sort()
  }, [signals])

  // Apply client-side filters
  const filtered = useMemo(() => {
    return signals.filter(s => {
      if (coinFilter && s.coin !== coinFilter) return false
      if (sideFilter !== 'all' && s.side !== sideFilter) return false
      if (confidenceFilter !== 'all' && s.confidence !== confidenceFilter) return false
      return true
    })
  }, [signals, coinFilter, sideFilter, confidenceFilter])

  return (
    <div>
      <div className="px-4 py-4 lg:px-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold mb-1">Signals</h2>
          <p className="text-white/55 text-xs">
            Live smart money signals from tracked Hyperliquid wallets
          </p>
        </div>

        {/* Consensus alerts banner */}
        {consensus.length > 0 && (
          <div className="space-y-2">
            {consensus.map((c, i) => {
              const isLong = c.side === 'long'
              return (
                <motion.div
                  key={`${c.coin}-${c.side}`}
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className={`rounded-lg p-4 border ${
                    isLong
                      ? 'bg-[#34EAB9]/[0.06] border-[#34EAB9]/20'
                      : 'bg-[#FF3B5C]/[0.06] border-[#FF3B5C]/20'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Users size={14} className={isLong ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'} />
                      <span className="text-xs font-semibold">
                        Consensus Signal — {c.wallet_count} wallets aligned
                      </span>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${CONFIDENCE_COLORS[c.avg_confidence] || CONFIDENCE_COLORS.medium}`}>
                      {c.avg_confidence.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold">{c.coin}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      isLong ? 'bg-[#34EAB9]/15 text-[#34EAB9]' : 'bg-[#FF3B5C]/15 text-[#FF3B5C]'
                    }`}>
                      {c.side.toUpperCase()}
                    </span>
                    <span className="text-xs text-white/50 font-mono">
                      {formatUsd(c.total_notional)} combined
                    </span>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-2 flex-wrap">
          <select
            value={coinFilter}
            onChange={e => setCoinFilter(e.target.value)}
            className="bg-[#0F1A1E] border border-white/[0.12] rounded-lg px-3 py-1.5 text-xs outline-none focus:border-[#34EAB9]"
          >
            <option value="">All Markets</option>
            {availableCoins.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <select
            value={sideFilter}
            onChange={e => setSideFilter(e.target.value as SideFilter)}
            className="bg-[#0F1A1E] border border-white/[0.12] rounded-lg px-3 py-1.5 text-xs outline-none focus:border-[#34EAB9]"
          >
            <option value="all">All Sides</option>
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>

          <select
            value={confidenceFilter}
            onChange={e => setConfidenceFilter(e.target.value as ConfidenceFilter)}
            className="bg-[#0F1A1E] border border-white/[0.12] rounded-lg px-3 py-1.5 text-xs outline-none focus:border-[#34EAB9]"
          >
            <option value="all">All Confidence</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          {(coinFilter || sideFilter !== 'all' || confidenceFilter !== 'all') && (
            <button
              onClick={() => { setCoinFilter(''); setSideFilter('all'); setConfidenceFilter('all') }}
              className="text-[10px] text-white/40 hover:text-white/70 transition-colors px-2"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Signals feed */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="card p-4 animate-pulse">
                <div className="h-4 bg-white/[0.06] rounded w-1/3 mb-2" />
                <div className="h-3 bg-white/[0.04] rounded w-2/3" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card p-8 text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-lg bg-[#0F1A1E] flex items-center justify-center">
              <Activity size={24} className="text-[#34EAB9]" />
            </div>
            <h3 className="text-base font-semibold mb-2">No Active Signals</h3>
            <p className="text-white/40 text-sm max-w-sm mx-auto leading-relaxed">
              Signals are generated when tracked wallets open positions above $50,000 notional on Hyperliquid.
              Active signals appear here automatically and expire after 24 hours.
            </p>
            {signals.length > 0 && filtered.length === 0 && (
              <p className="text-white/30 text-xs mt-3">
                {signals.length} signal{signals.length > 1 ? 's' : ''} hidden by filters.{' '}
                <button
                  onClick={() => { setCoinFilter(''); setSideFilter('all'); setConfidenceFilter('all') }}
                  className="text-[#34EAB9] hover:underline"
                >
                  Clear filters
                </button>
              </p>
            )}
          </motion.div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((signal, i) => {
              const isLong = signal.side === 'long'
              return (
                <motion.div
                  key={signal.signal_id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="card p-4 relative group"
                >
                  {/* Dismiss button */}
                  <button
                    onClick={() => dismissSignal(signal.signal_id)}
                    className="absolute top-3 right-3 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-white/[0.08] transition-all text-white/40 hover:text-white/70"
                    title="Dismiss signal"
                  >
                    <X size={14} />
                  </button>

                  {/* Coin + Side */}
                  <div className="flex items-center gap-2 mb-3">
                    {isLong ? (
                      <TrendingUp size={16} className="text-[#34EAB9]" />
                    ) : (
                      <TrendingDown size={16} className="text-[#FF3B5C]" />
                    )}
                    <span className="text-base font-bold">{signal.coin}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      isLong ? 'bg-[#34EAB9]/15 text-[#34EAB9]' : 'bg-[#FF3B5C]/15 text-[#FF3B5C]'
                    }`}>
                      {signal.side.toUpperCase()}
                    </span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ml-auto ${CONFIDENCE_COLORS[signal.confidence]}`}>
                      {signal.confidence.toUpperCase()}
                    </span>
                  </div>

                  {/* Details */}
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="bg-[#0F1A1E] rounded p-2">
                      <p className="text-[9px] text-white/40 mb-0.5">Entry Price</p>
                      <p className="font-mono text-xs font-semibold">
                        ${Number(signal.entry_price).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="bg-[#0F1A1E] rounded p-2">
                      <p className="text-[9px] text-white/40 mb-0.5">Notional</p>
                      <p className="font-mono text-xs font-semibold">{formatUsd(Number(signal.notional_usd))}</p>
                    </div>
                  </div>

                  {/* Wallet */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      {signal.wallet_label ? (
                        <span className="text-xs text-white/70">{signal.wallet_label}</span>
                      ) : (
                        <CopyableAddress address={signal.wallet_address} mono className="text-[10px]" />
                      )}
                    </div>
                  </div>

                  {/* Time info */}
                  <div className="flex items-center justify-between text-[10px] text-white/30">
                    <div className="flex items-center gap-1">
                      <Clock size={10} />
                      <span>{timeAgo(signal.timestamp)}</span>
                    </div>
                    <span>{expiryCountdown(signal.expires_at)}</span>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
