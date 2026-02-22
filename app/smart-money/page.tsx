'use client'
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { TopBar } from '@/components/layout/TopBar'
import { SkeletonCard } from '@/components/ui/SkeletonCard'
import { ChevronDown, ExternalLink, TrendingUp, TrendingDown, Users, Eye } from 'lucide-react'

interface WalletPosition {
  coin: string
  size: number
  side: 'Long' | 'Short'
  notional: number
  leverage: number
  pnl: number
  entryPx: number
}

interface SmartMoneyWallet {
  address: string
  accountValue: number
  positions: WalletPosition[]
  totalLong: number
  totalShort: number
  positionCount: number
  cumulativePnl: number
  unrealizedPnl: number
  totalPnl: number
}

interface TopCoin {
  coin: string
  notional: number
  longPct: number
}

interface TierData {
  name: string
  emoji: string
  min: number
  max: number
  wallets: SmartMoneyWallet[]
  totalLong: number
  totalShort: number
  longRatio: number
  sentiment: 'Bullish' | 'Bearish' | 'Neutral'
  netBias: number
  inPositionPct: number
  topCoins: TopCoin[]
}

const sentimentColor = (s: string) => {
  if (s === 'Bullish') return 'bg-[#00ff88] text-black'
  if (s === 'Bearish') return 'bg-[#ff3b3b] text-white'
  return 'bg-[#555555] text-white'
}

const formatUsd = (n: number) => {
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toLocaleString()}`
}

const tierRange = (min: number, max: number) => {
  const fmtMin = min >= 1e6 ? `${min / 1e6}M` : min >= 1e3 ? `${min / 1e3}K` : min.toString()
  if (max === Infinity) return `$${fmtMin}+`
  const fmtMax = max >= 1e6 ? `${max / 1e6}M` : max >= 1e3 ? `${max / 1e3}K` : max.toString()
  return `$${fmtMin} – $${fmtMax}`
}

export default function SmartMoneyPage() {
  const [tiers, setTiers] = useState<TierData[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [expandedTier, setExpandedTier] = useState<string | null>(null)
  const [expandedWallet, setExpandedWallet] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/smart-money')
        if (res.ok) {
          const data = await res.json()
          setTiers(data.tiers || [])
          setTotal(data.total || 0)
        }
      } catch {
        // Will retry
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const toggleTier = (name: string) => {
    setExpandedTier(prev => prev === name ? null : name)
    setExpandedWallet(null)
  }

  const toggleWallet = (addr: string) => {
    setExpandedWallet(prev => prev === addr ? null : addr)
  }

  return (
    <div>
      <TopBar title="Smart Money" />
      <div className="px-4 py-4 lg:px-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold mb-1">Smart Money Tracker</h2>
          <p className="text-[#888888] text-xs">
            Live scan of {total > 0 ? total.toLocaleString() : '—'} wallets grouped by perp equity tier.
            Tap a tier to see wallets inside, tap a wallet to see their positions.
          </p>
        </div>

        {/* Aggregate overview */}
        {!loading && tiers.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            <div className="card p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-[#666666] mb-1">Total Wallets</p>
              <p className="font-bold text-lg">{total.toLocaleString()}</p>
            </div>
            <div className="card p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-[#666666] mb-1">Tiers Active</p>
              <p className="font-bold text-lg">{tiers.length}</p>
            </div>
            <div className="card p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-[#666666] mb-1">Biggest Tier</p>
              <p className="font-bold text-lg">{tiers[0]?.emoji} {tiers[0]?.name || '—'}</p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : tiers.length > 0 ? (
          <div className="space-y-3">
            {tiers.map((tier, i) => {
              const isExpanded = expandedTier === tier.name
              return (
                <motion.div
                  key={tier.name}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  {/* Tier header - clickable */}
                  <button
                    onClick={() => toggleTier(tier.name)}
                    className="card p-4 w-full text-left hover:border-[#333333] transition-colors"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{tier.emoji}</span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-base">{tier.name}</span>
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${sentimentColor(tier.sentiment)}`}>
                              {tier.sentiment}
                            </span>
                          </div>
                          <p className="text-[#666666] text-xs">{tierRange(tier.min, tier.max)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="flex items-center gap-1.5">
                            <Users size={12} className="text-[#888888]" />
                            <span className="font-semibold text-sm">{tier.wallets.length}</span>
                          </div>
                          <p className="text-[10px] text-[#666666]">{tier.inPositionPct}% active</p>
                        </div>
                        <ChevronDown
                          size={16}
                          className={`text-[#888888] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        />
                      </div>
                    </div>

                    {/* Stats row */}
                    <div className="grid grid-cols-4 gap-2 text-xs">
                      <div className="bg-[#111111] rounded-lg p-2">
                        <p className="text-[#666666] text-[10px] mb-0.5">Long</p>
                        <p className="text-[#00ff88] font-semibold">{formatUsd(tier.totalLong)}</p>
                      </div>
                      <div className="bg-[#111111] rounded-lg p-2">
                        <p className="text-[#666666] text-[10px] mb-0.5">Short</p>
                        <p className="text-[#ff3b3b] font-semibold">{formatUsd(tier.totalShort)}</p>
                      </div>
                      <div className="bg-[#111111] rounded-lg p-2">
                        <p className="text-[#666666] text-[10px] mb-0.5">L/S Ratio</p>
                        <p className="font-semibold">{tier.longRatio}%</p>
                      </div>
                      <div className="bg-[#111111] rounded-lg p-2">
                        <p className="text-[#666666] text-[10px] mb-0.5">Net Bias</p>
                        <p className={`font-semibold ${tier.netBias >= 0 ? 'text-[#00ff88]' : 'text-[#ff3b3b]'}`}>
                          {tier.netBias >= 0 ? '+' : ''}{formatUsd(tier.netBias)}
                        </p>
                      </div>
                    </div>

                    {/* Long/Short bar */}
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-[10px] text-[#00ff88]">L</span>
                      <div className="flex-1 h-1.5 bg-[#ff3b3b30] rounded-full overflow-hidden">
                        <div className="h-full bg-[#00ff88] rounded-full transition-all" style={{ width: `${tier.longRatio}%` }} />
                      </div>
                      <span className="text-[10px] text-[#ff3b3b]">S</span>
                    </div>
                  </button>

                  {/* Expanded tier content */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        {/* Top coins for this tier */}
                        {tier.topCoins.length > 0 && (
                          <div className="mt-2 card p-3">
                            <p className="text-[10px] uppercase tracking-wider text-[#666666] mb-2">Top Traded Coins in {tier.name} Tier</p>
                            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                              {tier.topCoins.map(tc => (
                                <div key={tc.coin} className="bg-[#111111] rounded-lg px-3 py-2 min-w-[90px] flex-shrink-0">
                                  <p className="font-semibold text-xs">{tc.coin}</p>
                                  <p className="text-[10px] text-[#888888]">{formatUsd(tc.notional)}</p>
                                  <div className="flex items-center gap-1 mt-1">
                                    <div className="flex-1 h-1 bg-[#ff3b3b30] rounded-full overflow-hidden">
                                      <div className="h-full bg-[#00ff88] rounded-full" style={{ width: `${tc.longPct}%` }} />
                                    </div>
                                    <span className="text-[9px] text-[#888888]">{tc.longPct}%L</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Wallet list */}
                        <div className="mt-2 space-y-1">
                          {tier.wallets.map((wallet, wi) => {
                            const isWalletExpanded = expandedWallet === wallet.address
                            const shortAddr = `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`
                            const totalNotional = wallet.totalLong + wallet.totalShort
                            const walletLongPct = totalNotional > 0 ? Math.round((wallet.totalLong / totalNotional) * 100) : 0

                            return (
                              <div key={wallet.address}>
                                <button
                                  onClick={() => toggleWallet(wallet.address)}
                                  className="card p-3 w-full text-left hover:border-[#333333] transition-colors"
                                >
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                      <span className="text-[#666666] text-xs font-mono w-5">#{wi + 1}</span>
                                      <div>
                                        <div className="flex items-center gap-2">
                                          <span className="font-mono text-sm">{shortAddr}</span>
                                          <Link
                                            href={`/wallet/${wallet.address}`}
                                            onClick={e => e.stopPropagation()}
                                            className="text-[#888888] hover:text-[#00ff88]"
                                          >
                                            <ExternalLink size={11} />
                                          </Link>
                                        </div>
                                        <p className="text-[10px] text-[#666666]">
                                          {wallet.positionCount} position{wallet.positionCount !== 1 ? 's' : ''} &middot; {formatUsd(wallet.accountValue)} equity
                                        </p>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                      <div className="text-right">
                                        <p className={`text-xs font-bold ${wallet.totalPnl >= 0 ? 'text-[#00ff88]' : 'text-[#ff3b3b]'}`}>
                                          {wallet.totalPnl >= 0 ? '+' : ''}{formatUsd(wallet.totalPnl)}
                                        </p>
                                        <p className="text-[9px] text-[#666666]">All-time PnL</p>
                                      </div>
                                      {wallet.positionCount > 0 && (
                                        <div className="text-right">
                                          {walletLongPct >= 50 ? (
                                            <TrendingUp size={12} className="text-[#00ff88]" />
                                          ) : (
                                            <TrendingDown size={12} className="text-[#ff3b3b]" />
                                          )}
                                        </div>
                                      )}
                                      <ChevronDown
                                        size={14}
                                        className={`text-[#666666] transition-transform ${isWalletExpanded ? 'rotate-180' : ''}`}
                                      />
                                    </div>
                                  </div>
                                </button>

                                {/* Expanded wallet positions */}
                                <AnimatePresence>
                                  {isWalletExpanded && wallet.positions.length > 0 && (
                                    <motion.div
                                      initial={{ opacity: 0, height: 0 }}
                                      animate={{ opacity: 1, height: 'auto' }}
                                      exit={{ opacity: 0, height: 0 }}
                                      className="overflow-hidden"
                                    >
                                      <div className="ml-8 mr-2 mt-1 mb-2 bg-[#0d0d0d] rounded-xl border border-[#1a1a1a] overflow-hidden">
                                        <table className="w-full text-xs">
                                          <thead>
                                            <tr className="text-[#666666] border-b border-[#1a1a1a]">
                                              <th className="text-left py-2 px-3 font-medium">Coin</th>
                                              <th className="text-left py-2 px-1 font-medium">Side</th>
                                              <th className="text-right py-2 px-1 font-medium">Size</th>
                                              <th className="text-right py-2 px-1 font-medium">Notional</th>
                                              <th className="text-right py-2 px-1 font-medium">Entry</th>
                                              <th className="text-right py-2 px-1 font-medium">Lev</th>
                                              <th className="text-right py-2 px-3 font-medium">uPnL</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {wallet.positions.map((pos, pi) => (
                                              <tr key={pi} className="border-t border-[#1a1a1a]">
                                                <td className="py-2 px-3 font-medium">{pos.coin}</td>
                                                <td className={`py-2 px-1 ${pos.side === 'Long' ? 'text-[#00ff88]' : 'text-[#ff3b3b]'}`}>
                                                  {pos.side}
                                                </td>
                                                <td className="py-2 px-1 text-right font-mono">{pos.size.toFixed(4)}</td>
                                                <td className="py-2 px-1 text-right font-mono">{formatUsd(pos.notional)}</td>
                                                <td className="py-2 px-1 text-right font-mono">${pos.entryPx.toLocaleString()}</td>
                                                <td className="py-2 px-1 text-right">{pos.leverage}x</td>
                                                <td className={`py-2 px-3 text-right font-mono ${pos.pnl >= 0 ? 'text-[#00ff88]' : 'text-[#ff3b3b]'}`}>
                                                  {pos.pnl >= 0 ? '+' : ''}${pos.pnl.toFixed(2)}
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                        {/* PnL summary */}
                                        <div className="px-3 py-2 border-t border-[#1a1a1a] grid grid-cols-3 gap-2 text-[10px]">
                                          <div>
                                            <span className="text-[#666666]">Realized PnL: </span>
                                            <span className={wallet.cumulativePnl >= 0 ? 'text-[#00ff88]' : 'text-[#ff3b3b]'}>
                                              {wallet.cumulativePnl >= 0 ? '+' : ''}{formatUsd(wallet.cumulativePnl)}
                                            </span>
                                          </div>
                                          <div>
                                            <span className="text-[#666666]">Unrealized: </span>
                                            <span className={wallet.unrealizedPnl >= 0 ? 'text-[#00ff88]' : 'text-[#ff3b3b]'}>
                                              {wallet.unrealizedPnl >= 0 ? '+' : ''}{formatUsd(wallet.unrealizedPnl)}
                                            </span>
                                          </div>
                                          <div>
                                            <span className="text-[#666666]">Total: </span>
                                            <span className={`font-bold ${wallet.totalPnl >= 0 ? 'text-[#00ff88]' : 'text-[#ff3b3b]'}`}>
                                              {wallet.totalPnl >= 0 ? '+' : ''}{formatUsd(wallet.totalPnl)}
                                            </span>
                                          </div>
                                        </div>
                                        <div className="px-3 py-2 border-t border-[#1a1a1a] flex justify-end">
                                          <Link
                                            href={`/wallet/${wallet.address}`}
                                            className="flex items-center gap-1 text-[10px] text-[#00ff88] hover:underline"
                                          >
                                            <Eye size={10} />
                                            Full Profile
                                          </Link>
                                        </div>
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>

                                {isWalletExpanded && wallet.positions.length === 0 && (
                                  <p className="ml-8 text-xs text-[#666666] py-2">No open positions</p>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )
            })}
          </div>
        ) : (
          <div className="card p-8 text-center">
            <p className="text-[#888888] text-sm mb-2">No wallet data available</p>
            <p className="text-[#666666] text-xs">Make sure Supabase is configured and wallets are seeded, or check that the Hyperliquid API is reachable.</p>
          </div>
        )}
      </div>
    </div>
  )
}
