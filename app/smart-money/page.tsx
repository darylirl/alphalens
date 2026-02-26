'use client'
import { useEffect, useState, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { SkeletonCard } from '@/components/ui/SkeletonCard'
import { ChevronDown, Eye, Shield, Zap, Users, Clock, ArrowUpRight, ArrowDownRight } from 'lucide-react'

interface CoinWallet {
  address: string
  accountValue: number
  tier: string
  side: 'Long' | 'Short'
  notional: number
  pnl: number
  leverage: number
  totalPnl: number
  cumulativePnl: number
  fundingPnl: number
  firstTradeTime: number | null
}

interface TierBreakdown { tier: string; emoji: string; count: number }
interface ConfidenceFactors { consensus: number; liquidity: number; participation: number; whaleAlignment: number }

interface TokenData {
  coin: string
  direction: 'Long' | 'Short' | 'Mixed'
  longPct: number
  totalLiquidity: number
  longNotional: number
  shortNotional: number
  walletCount: number
  confidence: number
  confidenceFactors: ConfidenceFactors
  tierBreakdown: TierBreakdown[]
  wallets: CoinWallet[]
  aggregatePnl: number
  category: string
  isStock: boolean
  price: number
  change24h: number
  volume24h: number
}

interface TierWallet {
  address: string
  accountValue: number
  positionCount: number
  totalLong: number
  totalShort: number
  cumulativePnl: number
  unrealizedPnl: number
  totalPnl: number
  fundingPnl: number
  firstTradeTime: number | null
  topPositions: Array<{ coin: string; side: string; notional: number; leverage: number; pnl: number }>
}

interface TierSummary {
  name: string
  emoji: string
  count: number
  longRatio: number
  totalNotional: number
  avgPnl: number
  totalPnl: number
  wallets: TierWallet[]
}

interface SectorInsight {
  category: string
  isStock: boolean
  tokenCount: number
  totalLiquidity: number
  totalWallets: number
  avgConfidence: number
  bias: 'Bullish' | 'Bearish' | 'Mixed'
  narrative: string
  topToken: string
  topTokenConfidence: number
}

const formatUsd = (n: number) => {
  const abs = Math.abs(n)
  if (abs >= 1e9) return `$${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `$${(abs / 1e3).toFixed(1)}K`
  return `$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

const directionBg = (d: string) => {
  if (d === 'Long') return 'bg-[#34EAB920] text-[#34EAB9]'
  if (d === 'Short') return 'bg-[#FF3B5C20] text-[#FF3B5C]'
  return 'bg-white/[0.08] text-white/55'
}

const biasColor = (b: string) => {
  if (b === 'Bullish') return 'text-[#34EAB9]'
  if (b === 'Bearish') return 'text-[#FF3B5C]'
  return 'text-white/55'
}

const confidenceColor = (score: number) => {
  if (score >= 7) return '#34EAB9'
  if (score >= 4) return 'rgba(255,255,255,0.55)'
  return '#FF3B5C'
}

const pnlColor = (n: number) => n >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'

function timeAgo(ts: number | null): string {
  if (!ts) return '—'
  const diff = Date.now() - ts
  const days = Math.floor(diff / 86400000)
  if (days > 365) return `${Math.floor(days / 365)}y ago`
  if (days > 30) return `${Math.floor(days / 30)}mo ago`
  if (days > 0) return `${days}d ago`
  const hours = Math.floor(diff / 3600000)
  if (hours > 0) return `${hours}h ago`
  return 'recent'
}

function ConfidenceGauge({ score, size = 'lg' }: { score: number; size?: 'sm' | 'lg' }) {
  const radius = size === 'lg' ? 28 : 16
  const stroke = size === 'lg' ? 4 : 3
  const circumference = 2 * Math.PI * radius
  const progress = (score / 10) * circumference
  const color = confidenceColor(score)

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={radius * 2 + stroke * 2} height={radius * 2 + stroke * 2} className="-rotate-90">
        <circle cx={radius + stroke} cy={radius + stroke} r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
        <circle cx={radius + stroke} cy={radius + stroke} r={radius} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circumference} strokeDashoffset={circumference - progress} strokeLinecap="round" />
      </svg>
      <span className="absolute font-bold" style={{ color, fontSize: size === 'lg' ? '14px' : '10px' }}>{score}</span>
    </div>
  )
}

export default function SmartMoneyPage() {
  const [tokens, setTokens] = useState<TokenData[]>([])
  const [sectorInsights, setSectorInsights] = useState<SectorInsight[]>([])
  const [tierSummary, setTierSummary] = useState<TierSummary[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [stockPerpsAvailable, setStockPerpsAvailable] = useState(0)
  const [loading, setLoading] = useState(true)
  const [expandedCoin, setExpandedCoin] = useState<string | null>(null)
  const [expandedTier, setExpandedTier] = useState<string | null>(null)
  const [activeCategory, setActiveCategory] = useState('All')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/smart-money')
        if (res.ok && !cancelled) {
          const data = await res.json()
          setTokens(data.tokens || [])
          setSectorInsights(data.sectorInsights || [])
          setTierSummary(data.tierSummary || [])
          setCategories(data.categories || [])
          setTotal(data.total || 0)
          setStockPerpsAvailable(data.stockPerpsAvailable || 0)
        }
      } catch { /* network error */ }
      finally { if (!cancelled) setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const filteredTokens = useMemo(() => {
    if (activeCategory === 'All') return tokens
    if (activeCategory === 'Stock Perps') return tokens.filter(t => t.isStock)
    return tokens.filter(t => t.category === activeCategory)
  }, [tokens, activeCategory])

  const activeSectorInsight = useMemo(() => {
    if (activeCategory === 'All') return null
    return sectorInsights.find(s => s.category === activeCategory) || null
  }, [sectorInsights, activeCategory])

  const allCategories = useMemo(() => {
    const cats = ['All', ...categories]
    if (stockPerpsAvailable > 0 && !categories.includes('Stock Perps')) {
      cats.splice(1, 0, 'Stock Perps')
    }
    return cats
  }, [categories, stockPerpsAvailable])

  const toggleTier = useCallback((name: string) => {
    setExpandedTier(prev => prev === name ? null : name)
  }, [])

  const toggleCoin = useCallback((coin: string) => {
    setExpandedCoin(prev => prev === coin ? null : coin)
  }, [])

  return (
    <div>
      <div className="px-4 py-4 lg:px-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold mb-1">Smart Money Flow</h2>
          <p className="text-white/55 text-xs">
            {total > 0 && tokens.length > 0 ? (
              <>Live scan of <span className="font-mono">{total.toLocaleString()}</span> wallets across <span className="font-mono">{tokens.length}</span> assets. Confidence scoring powered by consensus, liquidity, participation, and whale alignment.</>
            ) : (
              <>Real-time analysis of smart money positions across Hyperliquid.</>
            )}
          </p>
        </div>

        {/* ═══ Clickable Tier Overview ═══ */}
        {!loading && tierSummary.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Wallet Tiers</h3>
              <span className="text-[10px] text-white/40">Click to view wallets</span>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              {tierSummary.map(t => (
                <button
                  key={t.name}
                  onClick={() => toggleTier(t.name)}
                  className={`card px-3 py-2 min-w-[120px] flex-shrink-0 text-left transition-all ${
                    expandedTier === t.name
                      ? 'border-[#34EAB9] bg-[#34EAB908]'
                      : 'hover:border-white/[0.12]'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-sm">{t.emoji}</span>
                    <span className="text-xs font-semibold">{t.name}</span>
                    <ChevronDown
                      size={10}
                      className={`ml-auto text-white/55 transition-transform ${expandedTier === t.name ? 'rotate-180' : ''}`}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-white/55">{t.count} wallets</span>
                    <span className={`text-[10px] font-semibold ${t.longRatio > 55 ? 'text-[#34EAB9]' : t.longRatio < 45 ? 'text-[#FF3B5C]' : 'text-white/55'}`}>
                      {t.longRatio}%L
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[9px] text-white/40">{formatUsd(t.totalNotional)}</span>
                    <span className={`text-[9px] font-semibold ${pnlColor(t.totalPnl)}`}>
                      {t.totalPnl >= 0 ? '+' : '-'}{formatUsd(t.totalPnl)}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            {/* Expanded tier wallet list */}
            <AnimatePresence>
              {expandedTier && (() => {
                const tier = tierSummary.find(t => t.name === expandedTier)
                if (!tier || tier.wallets.length === 0) return null
                return (
                  <motion.div
                    key={expandedTier}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="card p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Users size={14} className="text-[#34EAB9]" />
                          <h4 className="text-sm font-bold">{tier.emoji} {tier.name} Wallets</h4>
                          <span className="text-[10px] text-white/55">{tier.count} total</span>
                        </div>
                        <div className="text-right text-[10px]">
                          <span className="text-white/55">Avg PnL: </span>
                          <span className={pnlColor(tier.avgPnl)}>
                            {tier.avgPnl >= 0 ? '+' : '-'}{formatUsd(tier.avgPnl)}
                          </span>
                        </div>
                      </div>

                      <div className="overflow-x-auto -mx-4 px-4">
                        <table className="w-full text-xs min-w-[700px]">
                          <thead>
                            <tr className="text-white/40 text-[10px] border-b border-white/[0.08]">
                              <th className="text-left py-2 font-medium">Wallet</th>
                              <th className="text-right py-2 font-medium">Account Value</th>
                              <th className="text-right py-2 font-medium">Positions</th>
                              <th className="text-right py-2 font-medium">Long / Short</th>
                              <th className="text-right py-2 font-medium">Realized PnL</th>
                              <th className="text-right py-2 font-medium">Unrealized</th>
                              <th className="text-right py-2 font-medium">Funding</th>
                              <th className="text-right py-2 font-medium">Total PnL</th>
                              <th className="text-right py-2 font-medium">
                                <div className="flex items-center gap-0.5 justify-end">
                                  <Clock size={9} />
                                  <span>Since</span>
                                </div>
                              </th>
                              <th className="text-left py-2 font-medium pl-3">Top Coins</th>
                              <th className="py-2"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {tier.wallets.map(w => (
                              <tr key={w.address} className="border-t border-[#0F1A1E] hover:bg-[#0F1A1E] transition-colors">
                                <td className="py-2.5 font-mono text-[11px]">
                                  {w.address.slice(0, 6)}...{w.address.slice(-4)}
                                </td>
                                <td className="py-2.5 text-right font-mono font-semibold">
                                  {formatUsd(w.accountValue)}
                                </td>
                                <td className="py-2.5 text-right text-white/55">
                                  {w.positionCount}
                                </td>
                                <td className="py-2.5 text-right">
                                  <span className="text-[#34EAB9]">{formatUsd(w.totalLong)}</span>
                                  <span className="text-white/40 mx-0.5">/</span>
                                  <span className="text-[#FF3B5C]">{formatUsd(w.totalShort)}</span>
                                </td>
                                <td className={`py-2.5 text-right font-mono ${pnlColor(w.cumulativePnl)}`}>
                                  {w.cumulativePnl >= 0 ? '+' : '-'}{formatUsd(w.cumulativePnl)}
                                </td>
                                <td className={`py-2.5 text-right font-mono ${pnlColor(w.unrealizedPnl)}`}>
                                  {w.unrealizedPnl >= 0 ? '+' : '-'}{formatUsd(w.unrealizedPnl)}
                                </td>
                                <td className={`py-2.5 text-right font-mono ${pnlColor(w.fundingPnl)}`}>
                                  {w.fundingPnl >= 0 ? '+' : '-'}{formatUsd(w.fundingPnl)}
                                </td>
                                <td className={`py-2.5 text-right font-mono font-semibold ${pnlColor(w.totalPnl)}`}>
                                  {w.totalPnl >= 0 ? '+' : '-'}{formatUsd(w.totalPnl)}
                                </td>
                                <td className="py-2.5 text-right text-[10px] text-white/55">
                                  {timeAgo(w.firstTradeTime)}
                                </td>
                                <td className="py-2.5 pl-3">
                                  <div className="flex gap-1 flex-wrap">
                                    {w.topPositions.map((p, idx) => (
                                      <span
                                        key={idx}
                                        className={`text-[9px] px-1.5 py-0.5 rounded ${
                                          p.side === 'Long' ? 'bg-[#34EAB915] text-[#34EAB9]' : 'bg-[#FF3B5C15] text-[#FF3B5C]'
                                        }`}
                                      >
                                        {p.coin} {p.side === 'Long' ? '↑' : '↓'}
                                      </span>
                                    ))}
                                  </div>
                                </td>
                                <td className="py-2.5 pl-2">
                                  <Link href={`/wallet/${w.address}`} className="text-white/55 hover:text-[#34EAB9] transition-colors">
                                    <Eye size={12} />
                                  </Link>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </motion.div>
                )
              })()}
            </AnimatePresence>
          </div>
        )}

        {/* ═══ Category filter tabs ═══ */}
        {!loading && categories.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {allCategories.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`whitespace-nowrap text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                  activeCategory === cat
                    ? 'bg-[#34EAB9] text-[#0F1A1E]'
                    : 'bg-[#0F1A1E] text-white/55 hover:text-[#F0FAF8]'
                }`}
              >
                {cat}
                {cat !== 'All' && (
                  <span className="ml-1 opacity-70">
                    {cat === 'Stock Perps'
                      ? stockPerpsAvailable
                      : tokens.filter(t => t.category === cat).length}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* ═══ Sector insight card ═══ */}
        {activeSectorInsight && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card p-4 border-l-2 border-l-[#34EAB9]">
            <div className="flex items-start gap-3 mb-3">
              <Zap size={16} className="text-[#34EAB9] mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-bold text-sm">{activeSectorInsight.category} Insight</h3>
                  <span className={`text-[10px] font-bold ${biasColor(activeSectorInsight.bias)}`}>
                    {activeSectorInsight.bias.toUpperCase()}
                  </span>
                </div>
                <p className="text-xs text-[#F0FAF8] leading-relaxed">{activeSectorInsight.narrative}</p>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2 text-xs">
              <div className="bg-[#0F1A1E] rounded-lg p-2 text-center">
                <p className="text-[10px] text-white/40 mb-0.5">Assets</p>
                <p className="font-bold">{activeSectorInsight.tokenCount}</p>
              </div>
              <div className="bg-[#0F1A1E] rounded-lg p-2 text-center">
                <p className="text-[10px] text-white/40 mb-0.5">Liquidity</p>
                <p className="font-bold">{formatUsd(activeSectorInsight.totalLiquidity)}</p>
              </div>
              <div className="bg-[#0F1A1E] rounded-lg p-2 text-center">
                <p className="text-[10px] text-white/40 mb-0.5">Wallets</p>
                <p className="font-bold">{activeSectorInsight.totalWallets}</p>
              </div>
              <div className="bg-[#0F1A1E] rounded-lg p-2 text-center">
                <p className="text-[10px] text-white/40 mb-0.5">Avg Conf.</p>
                <p className="font-bold" style={{ color: confidenceColor(activeSectorInsight.avgConfidence) }}>
                  {activeSectorInsight.avgConfidence}/10
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* ═══ Sector overview cards (All view) ═══ */}
        {activeCategory === 'All' && !loading && sectorInsights.length > 0 && (
          <div>
            <h3 className="font-semibold text-sm mb-2">Sector Overview</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {sectorInsights.map(s => (
                <button
                  key={s.category}
                  onClick={() => setActiveCategory(s.category)}
                  className="card p-3 text-left hover:border-white/[0.12] transition-colors"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold">{s.category}</span>
                    <span className={`text-[9px] font-bold ${biasColor(s.bias)}`}>{s.bias}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] text-white/55">{s.tokenCount} assets</p>
                      <p className="text-xs font-semibold">{formatUsd(s.totalLiquidity)}</p>
                    </div>
                    <ConfidenceGauge score={s.avgConfidence} size="sm" />
                  </div>
                  {s.topToken && (
                    <p className="text-[9px] text-white/40 mt-1.5">
                      Top: {s.topToken} ({s.topTokenConfidence}/10)
                    </p>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ═══ Token list ═══ */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : tokens.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-white/55 text-sm">Smart money flow data is loading — check back shortly.</p>
          </div>
        ) : filteredTokens.length > 0 ? (
          <div className="space-y-3">
            {filteredTokens.map((token, i) => {
              const isExpanded = expandedCoin === token.coin
              return (
                <motion.div
                  key={token.coin}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                >
                  <button
                    onClick={() => toggleCoin(token.coin)}
                    className="card p-4 w-full text-left hover:border-white/[0.12] transition-colors"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <ConfidenceGauge score={token.confidence} />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-lg">{token.coin}</span>
                            {token.isStock && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#34EAB920] text-[#34EAB9]">STOCK</span>
                            )}
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${directionBg(token.direction)}`}>
                              {token.direction === 'Long' ? 'BULLISH' : token.direction === 'Short' ? 'BEARISH' : 'MIXED'}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-white/40">
                            <span>{token.walletCount} wallet{token.walletCount !== 1 ? 's' : ''}</span>
                            <span>&middot;</span>
                            <span>{formatUsd(token.totalLiquidity)} liq</span>
                            {token.price > 0 && (
                              <>
                                <span>&middot;</span>
                                <span className="font-mono">${token.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                                <span className={`font-mono ${token.change24h >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                                  {token.change24h >= 0 ? '+' : ''}{token.change24h}%
                                </span>
                              </>
                            )}
                            <span className="text-white/40">{token.category}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          <p className={`font-mono text-sm font-bold ${pnlColor(token.aggregatePnl)}`}>
                            {token.aggregatePnl >= 0 ? '+' : '-'}{formatUsd(token.aggregatePnl)}
                          </p>
                          <p className="text-[9px] text-white/40">Agg. uPnL</p>
                        </div>
                        <ChevronDown size={16} className={`text-white/55 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-2 text-xs">
                      <div className="bg-[#0F1A1E] rounded-lg p-2">
                        <p className="text-white/40 text-[10px] mb-0.5">Long</p>
                        <p className="font-mono text-[#34EAB9] font-semibold">{formatUsd(token.longNotional)}</p>
                      </div>
                      <div className="bg-[#0F1A1E] rounded-lg p-2">
                        <p className="text-white/40 text-[10px] mb-0.5">Short</p>
                        <p className="font-mono text-[#FF3B5C] font-semibold">{formatUsd(token.shortNotional)}</p>
                      </div>
                      <div className="bg-[#0F1A1E] rounded-lg p-2">
                        <p className="text-white/40 text-[10px] mb-0.5">L/S Split</p>
                        <p className="font-mono font-semibold">{token.longPct}% / {100 - token.longPct}%</p>
                      </div>
                      <div className="bg-[#0F1A1E] rounded-lg p-2">
                        <p className="text-white/40 text-[10px] mb-0.5">24h Vol</p>
                        <p className="font-mono font-semibold">{formatUsd(token.volume24h)}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-[10px] text-[#34EAB9]">L {token.longPct}%</span>
                      <div className="flex-1 h-2 bg-[#FF3B5C30] rounded-full overflow-hidden">
                        <div className="h-full bg-[#34EAB9] rounded-full transition-all" style={{ width: `${token.longPct}%` }} />
                      </div>
                      <span className="text-[10px] text-[#FF3B5C]">S {100 - token.longPct}%</span>
                    </div>
                  </button>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-2 card p-3">
                          <div className="flex items-center gap-1.5 mb-2">
                            <Shield size={12} className="text-white/55" />
                            <p className="text-[10px] uppercase tracking-wider text-white/40">Confidence Breakdown</p>
                          </div>
                          <div className="grid grid-cols-4 gap-2">
                            {[
                              { label: 'Consensus', value: token.confidenceFactors.consensus, desc: 'Direction align' },
                              { label: 'Liquidity', value: token.confidenceFactors.liquidity, desc: 'Capital depth' },
                              { label: 'Participation', value: token.confidenceFactors.participation, desc: 'Wallet count' },
                              { label: 'Whale Signal', value: token.confidenceFactors.whaleAlignment, desc: 'Big wallet align' },
                            ].map(f => (
                              <div key={f.label} className="text-center">
                                <ConfidenceGauge score={f.value} size="sm" />
                                <p className="text-[10px] font-semibold mt-1">{f.label}</p>
                                <p className="text-[8px] text-white/40">{f.desc}</p>
                              </div>
                            ))}
                          </div>
                        </div>

                        {token.tierBreakdown.length > 0 && (
                          <div className="mt-2 card p-3">
                            <p className="text-[10px] uppercase tracking-wider text-white/40 mb-2">Who&apos;s Trading {token.coin}</p>
                            <div className="flex gap-2 flex-wrap">
                              {token.tierBreakdown.map(tb => (
                                <button
                                  key={tb.tier}
                                  onClick={() => toggleTier(tb.tier)}
                                  className="bg-[#0F1A1E] rounded-lg px-3 py-1.5 flex items-center gap-1.5 hover:bg-white/[0.06] transition-colors"
                                >
                                  <span className="text-sm">{tb.emoji}</span>
                                  <span className="text-xs">{tb.tier}</span>
                                  <span className="text-[10px] text-white/55">&times;{tb.count}</span>
                                  <ArrowUpRight size={9} className="text-[#34EAB9] ml-0.5" />
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {token.wallets.length > 0 && (
                          <div className="mt-2 card p-3">
                            <p className="text-[10px] uppercase tracking-wider text-white/40 mb-2">Top Wallets on {token.coin}</p>
                            <div className="overflow-x-auto -mx-3 px-3">
                              <table className="w-full text-xs min-w-[600px]">
                                <thead>
                                  <tr className="text-white/40 text-[10px]">
                                    <th className="text-left py-1.5 font-medium">Wallet</th>
                                    <th className="text-left py-1.5 font-medium">Tier</th>
                                    <th className="text-left py-1.5 font-medium">Side</th>
                                    <th className="text-right py-1.5 font-medium">Notional</th>
                                    <th className="text-right py-1.5 font-medium">Lev</th>
                                    <th className="text-right py-1.5 font-medium">uPnL</th>
                                    <th className="text-right py-1.5 font-medium">All-time PnL</th>
                                    <th className="text-right py-1.5 font-medium">Funding</th>
                                    <th className="text-right py-1.5 font-medium">
                                      <div className="flex items-center gap-0.5 justify-end">
                                        <Clock size={8} />
                                        Since
                                      </div>
                                    </th>
                                    <th className="py-1.5"></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {token.wallets.map(w => (
                                    <tr key={w.address} className="border-t border-white/[0.08]">
                                      <td className="py-2 font-mono text-[11px]">{w.address.slice(0, 6)}...{w.address.slice(-4)}</td>
                                      <td className="py-2 text-[10px] text-white/55">{w.tier}</td>
                                      <td className="py-2">
                                        <span className={`inline-flex items-center gap-0.5 font-semibold ${w.side === 'Long' ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                                          {w.side === 'Long' ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                                          {w.side}
                                        </span>
                                      </td>
                                      <td className="py-2 text-right font-mono">{formatUsd(w.notional)}</td>
                                      <td className="py-2 text-right font-mono">{w.leverage}x</td>
                                      <td className={`py-2 text-right font-mono ${pnlColor(w.pnl)}`}>
                                        {w.pnl >= 0 ? '+' : '-'}{formatUsd(w.pnl)}
                                      </td>
                                      <td className={`py-2 text-right font-mono font-semibold ${pnlColor(w.totalPnl)}`}>
                                        {w.totalPnl >= 0 ? '+' : '-'}{formatUsd(w.totalPnl)}
                                      </td>
                                      <td className={`py-2 text-right font-mono ${pnlColor(w.fundingPnl)}`}>
                                        {w.fundingPnl >= 0 ? '+' : '-'}{formatUsd(w.fundingPnl)}
                                      </td>
                                      <td className="py-2 text-right text-[10px] text-white/55">
                                        {timeAgo(w.firstTradeTime)}
                                      </td>
                                      <td className="py-2 pl-2">
                                        <Link href={`/wallet/${w.address}`} className="text-white/55 hover:text-[#34EAB9] transition-colors">
                                          <Eye size={11} />
                                        </Link>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )
            })}
          </div>
        ) : (
          <div className="card p-8 text-center">
            <p className="text-white/55 text-sm mb-2">
              {activeCategory === 'Stock Perps'
                ? 'No stock perps detected on Hyperliquid yet'
                : activeCategory !== 'All'
                  ? `No positions found in ${activeCategory}`
                  : 'No wallet data available'}
            </p>
            <p className="text-white/40 text-xs">
              {activeCategory === 'Stock Perps'
                ? 'Stock perps (NVDA, TSLA, AAPL, etc.) will appear here automatically when Hyperliquid adds them to their universe.'
                : 'Make sure wallets are seeded and the Hyperliquid API is reachable.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
