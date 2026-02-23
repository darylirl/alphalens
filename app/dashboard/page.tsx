'use client'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { WalletCard } from '@/components/wallet/WalletCard'
import { SkeletonCard } from '@/components/ui/SkeletonCard'
import { PulseIndicator } from '@/components/ui/PulseIndicator'
import { Crosshair, TrendingUp, Activity, Zap, Search, Copy, DollarSign } from 'lucide-react'
import { MarketHeatmap } from '@/components/market/MarketHeatmap'
import type { WalletAnalytics } from '@/lib/hyperliquid/types'

export default function DashboardPage() {
  const router = useRouter()
  const [topWallets, setTopWallets] = useState<WalletAnalytics[]>([])
  const [loading, setLoading] = useState(true)
  const [walletQuery, setWalletQuery] = useState('')
  const [searchError, setSearchError] = useState('')
  const [marketStats, setMarketStats] = useState({ totalVolume: 0, openInterest: 0, topGainer: '', topGainerPct: 0, topGainers: [] as Array<{ name: string; change: number }>, heatmapAssets: [] as Array<{ name: string; change: number; volume: number; price: number; oi: number }> })

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/hunters?limit=5&sort=sharpe_30d')
        if (res.ok) {
          const data = await res.json()
          setTopWallets(Array.isArray(data) ? data.map((w: Record<string, unknown>) => ({
            address: w.address as string,
            label: w.label as string | undefined,
            archetype: w.archetype as string || 'unknown',
            archetypeConfidence: w.archetype_confidence as number || 0,
            sharpe7d: 0,
            sharpe30d: w.sharpe_30d as number || 0,
            sharpe90d: w.sharpe_90d as number || 0,
            alphaDecayScore: w.alpha_decay_score as number || 0,
            winRate: w.win_rate as number || 0,
            totalPnlUsd: w.total_pnl_usd as number || 0,
            tradeCount30d: w.trade_count_30d as number || 0,
            avgHoldSeconds: 0,
            avgLeverage: w.avg_leverage as number || 0,
            mostTradedAsset: '',
          })) : [])
        }
      } catch {
        // API not yet configured
      } finally {
        setLoading(false)
      }
    }

    async function loadMarket() {
      try {
        const res = await fetch('/api/market')
        if (res.ok) {
          const data = await res.json()
          setMarketStats({
            totalVolume: data.totalVolume || 0,
            openInterest: data.openInterest || 0,
            topGainer: data.topGainer || '',
            topGainerPct: data.topGainerPct || 0,
            topGainers: data.topGainers || [],
            heatmapAssets: data.heatmapAssets || [],
          })
        }
      } catch {
        // Will retry on next load
      }
    }

    load()
    loadMarket()
  }, [])

  return (
    <div>
      <div className="px-4 py-4 lg:px-6 space-y-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center justify-between mb-4">
            <p className="text-white/55 text-xs">Hyperliquid Trader Intelligence</p>
            <PulseIndicator />
          </div>
        </motion.div>

        {/* Wallet Search Bar */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.02 }}>
          <form onSubmit={e => {
            e.preventDefault()
            setSearchError('')
            const q = walletQuery.trim()
            if (!q) { setSearchError('Enter a wallet address'); return }
            // Auto-prepend 0x if missing
            const addr = q.startsWith('0x') ? q : `0x${q}`
            if (addr.length < 10) { setSearchError('Address too short'); return }
            if (!/^0x[a-fA-F0-9]+$/.test(addr)) { setSearchError('Invalid address format'); return }
            router.push(`/wallet/${addr}`)
            setWalletQuery('')
          }} className="flex gap-2">
            <div className="flex-1">
              <div className={`flex items-center gap-2 bg-[#0F1A1E] border rounded px-3 py-2.5 ${searchError ? 'border-[#FF3B5C]' : 'border-white/[0.08]'}`}>
                <Search size={16} className="text-white/55 flex-shrink-0" />
                <input
                  value={walletQuery}
                  onChange={e => { setWalletQuery(e.target.value); setSearchError('') }}
                  placeholder="Enter Hyperliquid Wallet Address (0x...)"
                  className="bg-transparent text-sm outline-none flex-1 placeholder:text-white/55"
                />
              </div>
              {searchError && <p className="text-[#FF3B5C] text-[10px] mt-1 ml-1">{searchError}</p>}
            </div>
            <button
              type="submit"
              className="bg-[#34EAB9] text-[#0F1A1E] text-sm font-semibold px-5 rounded hover:bg-[#2BD4A6] transition-colors"
            >
              Analyse
            </button>
          </form>
        </motion.div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="card p-3">
            <div className="flex items-center gap-2 mb-2">
              <Activity size={14} className="text-[#34EAB9]" />
              <span className="text-xs text-white/55">24h Volume</span>
            </div>
            <p className="font-mono font-semibold text-sm">${(marketStats.totalVolume / 1e9).toFixed(2)}B</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="card p-3">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp size={14} className="text-[#34EAB9]" />
              <span className="text-xs text-white/55">Open Interest</span>
            </div>
            <p className="font-mono font-semibold text-sm">${(marketStats.openInterest / 1e9).toFixed(2)}B</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="card p-3">
            <div className="flex items-center gap-2 mb-2">
              <Zap size={14} className="text-[#34EAB9]" />
              <span className="text-xs text-white/55">Top Gainer</span>
            </div>
            <p className="font-semibold text-sm">{marketStats.topGainer || '—'}</p>
            {marketStats.topGainerPct > 0 && (
              <p className="font-mono text-[#34EAB9] text-xs">+{marketStats.topGainerPct}%</p>
            )}
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="card p-3">
            <div className="flex items-center gap-2 mb-2">
              <Crosshair size={14} className="text-[#34EAB9]" />
              <span className="text-xs text-white/55">Tracked</span>
            </div>
            <p className="font-semibold text-sm">{topWallets.length > 0 ? `${topWallets.length}+` : '—'} wallets</p>
          </motion.div>
        </div>

        {marketStats.heatmapAssets.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }}>
            <h3 className="font-semibold text-sm mb-3">Market Heatmap</h3>
            <MarketHeatmap assets={marketStats.heatmapAssets} />
          </motion.div>
        )}

        {marketStats.topGainers.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
            <h3 className="font-semibold text-sm mb-3">Top Movers (24h)</h3>
            <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
              {marketStats.topGainers.slice(0, 8).map((g: { name: string; change: number }) => (
                <div key={g.name} className="card p-3 min-w-[100px] flex-shrink-0">
                  <p className="font-semibold text-sm">{g.name}</p>
                  <p className={`font-mono text-xs font-medium ${g.change >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                    {g.change >= 0 ? '+' : ''}{g.change}%
                  </p>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">Top Alpha Hunters</h3>
            <Link href="/hunters" className="text-[#34EAB9] text-xs font-medium">View All</Link>
          </div>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : topWallets.length > 0 ? (
            <div className="space-y-3">
              {topWallets.slice(0, 5).map((w, i) => (
                <WalletCard
                  key={w.address}
                  address={w.address}
                  label={w.label}
                  archetype={w.archetype}
                  sharpe30d={w.sharpe30d}
                  winRate={w.winRate}
                  totalPnl={w.totalPnlUsd}
                  alphaDecay={w.alphaDecayScore}
                  rank={i + 1}
                />
              ))}
            </div>
          ) : (
            <div className="card p-6 text-center">
              <p className="text-white/55 text-sm mb-3">No wallets tracked yet</p>
              <Link href="/hunters" className="inline-block bg-[#34EAB9] text-[#0F1A1E] text-sm font-semibold px-4 py-2 rounded">
                Start Hunting
              </Link>
            </div>
          )}
        </div>

        <div className="card p-4">
          <h3 className="font-semibold text-sm mb-2">Quick Actions</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Link href="/hunters" className="bg-[#0F1A1E] rounded p-3 text-center hover:bg-white/[0.06] transition-colors">
              <Crosshair size={18} className="mx-auto mb-1 text-[#34EAB9]" />
              <span className="text-xs">Hunt Alpha</span>
            </Link>
            <Link href="/smart-money" className="bg-[#0F1A1E] rounded p-3 text-center hover:bg-white/[0.06] transition-colors">
              <DollarSign size={18} className="mx-auto mb-1 text-[#34EAB9]" />
              <span className="text-xs">Smart Money</span>
            </Link>
            <Link href="/copy-trade" className="bg-[#0F1A1E] rounded p-3 text-center hover:bg-white/[0.06] transition-colors">
              <Copy size={18} className="mx-auto mb-1 text-[#34EAB9]" />
              <span className="text-xs">Copy Trade</span>
            </Link>
            <Link href="/quant" className="bg-[#0F1A1E] rounded p-3 text-center hover:bg-white/[0.06] transition-colors">
              <Zap size={18} className="mx-auto mb-1 text-[#34EAB9]" />
              <span className="text-xs">Pocket Quant</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
