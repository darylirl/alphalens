'use client'
import { useEffect, useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { TopBar } from '@/components/layout/TopBar'
import { SkeletonCard } from '@/components/ui/SkeletonCard'
import { ChevronDown, Eye, Shield, TrendingUp, TrendingDown, BarChart3, Zap } from 'lucide-react'

interface CoinWallet {
  address: string
  accountValue: number
  tier: string
  side: 'Long' | 'Short'
  notional: number
  pnl: number
  leverage: number
  totalPnl: number
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

interface TierSummary { name: string; emoji: string; count: number; longRatio: number; totalNotional: number }

const formatUsd = (n: number) => {
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toLocaleString()}`
}

const directionBg = (d: string) => {
  if (d === 'Long') return 'bg-[#00ff8820] text-[#00ff88]'
  if (d === 'Short') return 'bg-[#ff3b3b20] text-[#ff3b3b]'
  return 'bg-[#ffaa0020] text-[#ffaa00]'
}

const biasColor = (b: string) => {
  if (b === 'Bullish') return 'text-[#00ff88]'
  if (b === 'Bearish') return 'text-[#ff3b3b]'
  return 'text-[#ffaa00]'
}

const confidenceColor = (score: number) => {
  if (score >= 7) return '#00ff88'
  if (score >= 4) return '#ffaa00'
  return '#ff3b3b'
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
        <circle cx={radius + stroke} cy={radius + stroke} r={radius} fill="none" stroke="#222222" strokeWidth={stroke} />
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
  const [activeCategory, setActiveCategory] = useState('All')

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/smart-money')
        if (res.ok) {
          const data = await res.json()
          setTokens(data.tokens || [])
          setSectorInsights(data.sectorInsights || [])
          setTierSummary(data.tierSummary || [])
          setCategories(data.categories || [])
          setTotal(data.total || 0)
          setStockPerpsAvailable(data.stockPerpsAvailable || 0)
        }
      } catch {}
      finally { setLoading(false) }
    }
    load()
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

  const allCategories = ['All', ...categories]
  if (stockPerpsAvailable > 0 && !categories.includes('Stock Perps')) {
    allCategories.splice(1, 0, 'Stock Perps')
  }

  return (
    <div>
      <TopBar title="Smart Money" />
      <div className="px-4 py-4 lg:px-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold mb-1">Smart Money Flow</h2>
          <p className="text-[#888888] text-xs">
            Live scan of {total > 0 ? total.toLocaleString() : '—'} wallets across {tokens.length} assets.
            Confidence scoring powered by consensus, liquidity, participation, and whale alignment.
          </p>
        </div>

        {/* Tier overview bar */}
        {!loading && tierSummary.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {tierSummary.map(t => (
              <div key={t.name} className="card px-3 py-2 min-w-[100px] flex-shrink-0">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-sm">{t.emoji}</span>
                  <span className="text-xs font-semibold">{t.name}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-[#888888]">{t.count}</span>
                  <span className={`text-[10px] font-semibold ${t.longRatio > 55 ? 'text-[#00ff88]' : t.longRatio < 45 ? 'text-[#ff3b3b]' : 'text-[#888888]'}`}>
                    {t.longRatio}%L
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Category filter tabs */}
        {!loading && categories.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {allCategories.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`whitespace-nowrap text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                  activeCategory === cat
                    ? 'bg-[#00ff88] text-black'
                    : 'bg-[#161616] text-[#888888] hover:text-white'
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

        {/* Sector insight card */}
        {activeSectorInsight && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card p-4 border-l-2 border-l-[#00ff88]">
            <div className="flex items-start gap-3 mb-3">
              <Zap size={16} className="text-[#00ff88] mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-bold text-sm">{activeSectorInsight.category} Insight</h3>
                  <span className={`text-[10px] font-bold ${biasColor(activeSectorInsight.bias)}`}>
                    {activeSectorInsight.bias.toUpperCase()}
                  </span>
                </div>
                <p className="text-xs text-[#cccccc] leading-relaxed">{activeSectorInsight.narrative}</p>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2 text-xs">
              <div className="bg-[#111111] rounded-lg p-2 text-center">
                <p className="text-[10px] text-[#666666] mb-0.5">Assets</p>
                <p className="font-bold">{activeSectorInsight.tokenCount}</p>
              </div>
              <div className="bg-[#111111] rounded-lg p-2 text-center">
                <p className="text-[10px] text-[#666666] mb-0.5">Liquidity</p>
                <p className="font-bold">{formatUsd(activeSectorInsight.totalLiquidity)}</p>
              </div>
              <div className="bg-[#111111] rounded-lg p-2 text-center">
                <p className="text-[10px] text-[#666666] mb-0.5">Wallets</p>
                <p className="font-bold">{activeSectorInsight.totalWallets}</p>
              </div>
              <div className="bg-[#111111] rounded-lg p-2 text-center">
                <p className="text-[10px] text-[#666666] mb-0.5">Avg Conf.</p>
                <p className="font-bold" style={{ color: confidenceColor(activeSectorInsight.avgConfidence) }}>
                  {activeSectorInsight.avgConfidence}/10
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Sector overview cards (when All selected) */}
        {activeCategory === 'All' && !loading && sectorInsights.length > 0 && (
          <div>
            <h3 className="font-semibold text-sm mb-2">Sector Overview</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {sectorInsights.map(s => (
                <button
                  key={s.category}
                  onClick={() => setActiveCategory(s.category)}
                  className="card p-3 text-left hover:border-[#333333] transition-colors"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold">{s.category}</span>
                    <span className={`text-[9px] font-bold ${biasColor(s.bias)}`}>{s.bias}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] text-[#888888]">{s.tokenCount} assets</p>
                      <p className="text-xs font-semibold">{formatUsd(s.totalLiquidity)}</p>
                    </div>
                    <ConfidenceGauge score={s.avgConfidence} size="sm" />
                  </div>
                  {s.topToken && (
                    <p className="text-[9px] text-[#666666] mt-1.5">
                      Top: {s.topToken} ({s.topTokenConfidence}/10)
                    </p>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Token list */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
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
                    onClick={() => setExpandedCoin(isExpanded ? null : token.coin)}
                    className="card p-4 w-full text-left hover:border-[#333333] transition-colors"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <ConfidenceGauge score={token.confidence} />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-lg">{token.coin}</span>
                            {token.isStock && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#8855ff20] text-[#8855ff]">STOCK</span>
                            )}
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${directionBg(token.direction)}`}>
                              {token.direction === 'Long' ? 'BULLISH' : token.direction === 'Short' ? 'BEARISH' : 'MIXED'}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-[#666666]">
                            <span>{token.walletCount} wallet{token.walletCount !== 1 ? 's' : ''}</span>
                            <span>&middot;</span>
                            <span>{formatUsd(token.totalLiquidity)} liq</span>
                            {token.price > 0 && (
                              <>
                                <span>&middot;</span>
                                <span>${token.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                                <span className={token.change24h >= 0 ? 'text-[#00ff88]' : 'text-[#ff3b3b]'}>
                                  {token.change24h >= 0 ? '+' : ''}{token.change24h}%
                                </span>
                              </>
                            )}
                            <span className="text-[#444444]">{token.category}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          <p className={`text-sm font-bold ${token.aggregatePnl >= 0 ? 'text-[#00ff88]' : 'text-[#ff3b3b]'}`}>
                            {token.aggregatePnl >= 0 ? '+' : ''}{formatUsd(token.aggregatePnl)}
                          </p>
                          <p className="text-[9px] text-[#666666]">Agg. uPnL</p>
                        </div>
                        <ChevronDown size={16} className={`text-[#888888] transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-2 text-xs">
                      <div className="bg-[#111111] rounded-lg p-2">
                        <p className="text-[#666666] text-[10px] mb-0.5">Long</p>
                        <p className="text-[#00ff88] font-semibold">{formatUsd(token.longNotional)}</p>
                      </div>
                      <div className="bg-[#111111] rounded-lg p-2">
                        <p className="text-[#666666] text-[10px] mb-0.5">Short</p>
                        <p className="text-[#ff3b3b] font-semibold">{formatUsd(token.shortNotional)}</p>
                      </div>
                      <div className="bg-[#111111] rounded-lg p-2">
                        <p className="text-[#666666] text-[10px] mb-0.5">L/S Split</p>
                        <p className="font-semibold">{token.longPct}% / {100 - token.longPct}%</p>
                      </div>
                      <div className="bg-[#111111] rounded-lg p-2">
                        <p className="text-[#666666] text-[10px] mb-0.5">24h Vol</p>
                        <p className="font-semibold">{formatUsd(token.volume24h)}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-[10px] text-[#00ff88]">L {token.longPct}%</span>
                      <div className="flex-1 h-2 bg-[#ff3b3b30] rounded-full overflow-hidden">
                        <div className="h-full bg-[#00ff88] rounded-full transition-all" style={{ width: `${token.longPct}%` }} />
                      </div>
                      <span className="text-[10px] text-[#ff3b3b]">S {100 - token.longPct}%</span>
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
                            <Shield size={12} className="text-[#888888]" />
                            <p className="text-[10px] uppercase tracking-wider text-[#666666]">Confidence Breakdown</p>
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
                                <p className="text-[8px] text-[#666666]">{f.desc}</p>
                              </div>
                            ))}
                          </div>
                        </div>

                        {token.tierBreakdown.length > 0 && (
                          <div className="mt-2 card p-3">
                            <p className="text-[10px] uppercase tracking-wider text-[#666666] mb-2">Who&apos;s Trading {token.coin}</p>
                            <div className="flex gap-2 flex-wrap">
                              {token.tierBreakdown.map(tb => (
                                <div key={tb.tier} className="bg-[#111111] rounded-lg px-3 py-1.5 flex items-center gap-1.5">
                                  <span className="text-sm">{tb.emoji}</span>
                                  <span className="text-xs">{tb.tier}</span>
                                  <span className="text-[10px] text-[#888888]">&times;{tb.count}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {token.wallets.length > 0 && (
                          <div className="mt-2 card p-3">
                            <p className="text-[10px] uppercase tracking-wider text-[#666666] mb-2">Top Wallets</p>
                            <div className="overflow-x-auto -mx-3 px-3">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-[#666666] text-[10px]">
                                    <th className="text-left py-1.5 font-medium">Wallet</th>
                                    <th className="text-left py-1.5 font-medium">Tier</th>
                                    <th className="text-left py-1.5 font-medium">Side</th>
                                    <th className="text-right py-1.5 font-medium">Notional</th>
                                    <th className="text-right py-1.5 font-medium">Lev</th>
                                    <th className="text-right py-1.5 font-medium">uPnL</th>
                                    <th className="text-right py-1.5 font-medium">All-time</th>
                                    <th className="py-1.5"></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {token.wallets.map(w => (
                                    <tr key={w.address} className="border-t border-[#1a1a1a]">
                                      <td className="py-2 font-mono text-[11px]">{w.address.slice(0, 6)}...{w.address.slice(-4)}</td>
                                      <td className="py-2 text-[10px] text-[#888888]">{w.tier}</td>
                                      <td className={`py-2 font-semibold ${w.side === 'Long' ? 'text-[#00ff88]' : 'text-[#ff3b3b]'}`}>{w.side}</td>
                                      <td className="py-2 text-right font-mono">{formatUsd(w.notional)}</td>
                                      <td className="py-2 text-right">{w.leverage}x</td>
                                      <td className={`py-2 text-right font-mono ${w.pnl >= 0 ? 'text-[#00ff88]' : 'text-[#ff3b3b]'}`}>
                                        {w.pnl >= 0 ? '+' : ''}{formatUsd(w.pnl)}
                                      </td>
                                      <td className={`py-2 text-right font-mono ${w.totalPnl >= 0 ? 'text-[#00ff88]' : 'text-[#ff3b3b]'}`}>
                                        {w.totalPnl >= 0 ? '+' : ''}{formatUsd(w.totalPnl)}
                                      </td>
                                      <td className="py-2 pl-2">
                                        <Link href={`/wallet/${w.address}`} className="text-[#888888] hover:text-[#00ff88]">
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
            <p className="text-[#888888] text-sm mb-2">
              {activeCategory === 'Stock Perps'
                ? 'No stock perps detected on Hyperliquid yet'
                : activeCategory !== 'All'
                  ? `No positions found in ${activeCategory}`
                  : 'No wallet data available'}
            </p>
            <p className="text-[#666666] text-xs">
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
