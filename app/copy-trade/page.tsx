'use client'
/**
 * QUARANTINED FEATURE — copy trading was removed from the product.
 *
 * Our own replay backtests (backtest_copy.py, two runs: 28,318 copied trades
 * with real frictions — 60s delay, 5 bps slippage, 0.045% taker per side)
 * showed naive copy-trading loses money. Gross PnL was negative BEFORE fees:
 * the HFT cohort is structurally unmirrorable, and the slow-wallet cohort had
 * no aggregate edge to copy. Full findings live in /learn ("Why we killed
 * copy trading") and backtest_results/ in the repo.
 *
 * This page is now a static explainer. The legacy configuration UI is
 * preserved below as _LegacyCopyTradePage (unreferenced, never rendered) per
 * the honesty-remediation spec; the /api/copy-trade endpoints return 410.
 * Do not re-link this page to execution flows without a decision from Daryl.
 */
import Link from 'next/link'
import { FlaskConical, TrendingUp, BookOpen } from 'lucide-react'

export default function CopyTradeRetiredPage() {
  return (
    <div className="px-4 py-10 lg:px-6 max-w-2xl mx-auto space-y-6">
      <div>
        <p className="font-mono text-[11px] tracking-widest text-white/40 mb-3">RETIRED FEATURE</p>
        <h1 className="text-2xl font-bold mb-3">We removed copy trading. On purpose.</h1>
        <p className="text-white/55 text-sm leading-relaxed">
          Before shipping it, we tested it: 28,318 smart-money trades replayed
          across two cohorts and 13 months of history, executed the way a real
          copier would — 60 seconds late, with 5 bps slippage and 0.045% taker
          fees per side.
        </p>
      </div>

      <div className="card p-4 space-y-3">
        <p className="text-xs font-semibold text-white/70">What the replay showed</p>
        <ul className="space-y-2 text-sm text-white/55">
          <li className="flex gap-2">
            <span className="text-[#FF3B5C] shrink-0">—</span>
            Gross PnL was negative before a single fee was charged: the delay
            alone destroys short-horizon edges.
          </li>
          <li className="flex gap-2">
            <span className="text-[#FF3B5C] shrink-0">—</span>
            The most profitable wallets are high-frequency traders whose maker
            flow cannot be mirrored with taker orders at any delay.
          </li>
          <li className="flex gap-2">
            <span className="text-[#FF3B5C] shrink-0">—</span>
            Slow "copyable" wallets selected by trailing performance showed no
            persistent aggregate edge: monthly PnL alternated sign around a
            negative mean.
          </li>
        </ul>
        <p className="text-[11px] text-white/40 pt-1">
          Full methodology and per-trade results are in the repo
          (backtest_copy.py, backtest_results/).
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Link href="/learn" className="card p-4 hover:border-white/[0.16] transition-colors">
          <BookOpen size={16} className="text-[#34EAB9] mb-2" />
          <p className="text-xs font-semibold mb-1">Read the autopsy</p>
          <p className="text-[10px] text-white/40">Why we killed copy trading, with numbers</p>
        </Link>
        <Link href="/pulse" className="card p-4 hover:border-white/[0.16] transition-colors">
          <TrendingUp size={16} className="text-[#34EAB9] mb-2" />
          <p className="text-xs font-semibold mb-1">Watch the cohort</p>
          <p className="text-[10px] text-white/40">Real aggregated positioning, no promises</p>
        </Link>
        <Link href="/quant" className="card p-4 hover:border-white/[0.16] transition-colors">
          <FlaskConical size={16} className="text-[#34EAB9] mb-2" />
          <p className="text-xs font-semibold mb-1">Test your own idea</p>
          <p className="text-[10px] text-white/40">Backtest with real frictions included</p>
        </Link>
      </div>

      <p className="text-[10px] text-white/30">
        Nothing on this page is financial advice. We publish what we tested and
        what it showed; the decision stays yours.
      </p>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════
   LEGACY CODE BELOW — quarantined, unreferenced, never rendered.
   Kept for potential repositioning as an autopsy artifact per the build
   brief. The API endpoints it calls return 410 Gone.
   ════════════════════════════════════════════════════════════════════════ */

import { Suspense, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useSearchParams } from 'next/navigation'
import { useWallet } from '@/lib/wallet/WalletContext'
import { Copy, Wallet, Plus, ToggleLeft, ToggleRight, ExternalLink, Clock, Shield, ChevronDown, Zap, SlidersHorizontal, BarChart3 } from 'lucide-react'

const ASSET_CATEGORIES = ['All', 'Major', 'AI & Compute', 'Meme', 'DeFi', 'L1 & L2', 'Gaming', 'Infrastructure']
const DELAY_OPTIONS = [
  { label: 'Instant', value: 0, desc: 'Mirror immediately' },
  { label: '30s', value: 30, desc: 'Review window' },
  { label: '1 min', value: 60, desc: 'Short delay' },
  { label: '2 min', value: 120, desc: 'Full review' },
]

interface CopyConfig {
  target_address: string
  label?: string
  ratio: number
  max_position_size: number
  delay_seconds: number
  included_categories: string[]
  excluded_assets: string[]
  enabled: boolean
}

function _LegacyCopyTradePage() {
  return (
    <Suspense fallback={<div className="px-4 py-8 text-center text-white/55 text-sm">Loading...</div>}>
      <CopyTradeContent />
    </Suspense>
  )
}

function CopyTradeContent() {
  const { address, connect, connecting } = useWallet()
  const searchParams = useSearchParams()
  const prefillTarget = searchParams.get('target') || ''

  const [configs, setConfigs] = useState<CopyConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [showAdd, setShowAdd] = useState(!!prefillTarget)
  const [expandedConfig, setExpandedConfig] = useState<string | null>(null)

  // Form state
  const [newTarget, setNewTarget] = useState(prefillTarget)
  const [newLabel, setNewLabel] = useState('')
  const [newRatio, setNewRatio] = useState(25)
  const [newMaxSize, setNewMaxSize] = useState(5000)
  const [newDelay, setNewDelay] = useState(30)
  const [newCategories, setNewCategories] = useState<string[]>(['All'])
  const [newExcluded, setNewExcluded] = useState('')

  useEffect(() => {
    if (address) loadConfigs()
  }, [address])

  useEffect(() => {
    if (prefillTarget) {
      setNewTarget(prefillTarget)
      setShowAdd(true)
    }
  }, [prefillTarget])

  async function loadConfigs() {
    setLoading(true)
    try {
      const res = await fetch(`/api/copy-trade?user=${address}`)
      if (res.ok) {
        const data = await res.json()
        setConfigs((data.configs || []).map((c: Record<string, unknown>) => ({
          target_address: c.target_address as string,
          label: c.label as string | undefined,
          ratio: (c.ratio as number) || 100,
          max_position_size: (c.max_position_size as number) || 10000,
          delay_seconds: (c.delay_seconds as number) || 0,
          included_categories: (c.included_categories as string[]) || ['All'],
          excluded_assets: (c.excluded_assets as string[]) || [],
          enabled: c.enabled as boolean,
        })))
      }
    } catch {} finally {
      setLoading(false)
    }
  }

  async function addConfig() {
    if (!newTarget.startsWith('0x') || newTarget.length < 10) return
    try {
      const res = await fetch('/api/copy-trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAddress: address,
          targetAddress: newTarget,
          label: newLabel || undefined,
          ratio: newRatio,
          maxPositionSize: newMaxSize,
          delaySeconds: newDelay,
          includedCategories: newCategories,
          excludedAssets: newExcluded.split(',').map(s => s.trim()).filter(Boolean),
        }),
      })
      if (res.ok) {
        setShowAdd(false)
        resetForm()
        loadConfigs()
      }
    } catch {}
  }

  function resetForm() {
    setNewTarget('')
    setNewLabel('')
    setNewRatio(25)
    setNewMaxSize(5000)
    setNewDelay(30)
    setNewCategories(['All'])
    setNewExcluded('')
  }

  async function toggleConfig(target: string, enabled: boolean) {
    await fetch('/api/copy-trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userAddress: address, targetAddress: target, enabled }),
    })
    loadConfigs()
  }

  const toggleCategory = (cat: string) => {
    if (cat === 'All') {
      setNewCategories(['All'])
    } else {
      setNewCategories(prev => {
        const filtered = prev.filter(c => c !== 'All')
        return filtered.includes(cat) ? filtered.filter(c => c !== cat) : [...filtered, cat]
      })
    }
  }

  if (!address) {
    // Fabricated preview wallets removed in the honesty remediation: no
    // invented trading data anywhere, even inside quarantined code.
    const previewWallets: Array<{ addr: string; name: string; type: string; pnl: string; win: string; sharpe: string }> = []

    return (
      <div>
        <div className="px-4 py-8 lg:px-6 space-y-8">
          {/* Header & value prop */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="text-center max-w-lg mx-auto">
            <h1 className="font-display text-2xl md:text-3xl font-medium tracking-tight text-[#F0FAF8] mb-3">
              Copy the best. Automatically.
            </h1>
            <p className="text-white/55 text-sm leading-relaxed">
              Mirror the exact trades of top Hyperliquid wallets — with your own risk parameters. Set your allocation ratio, max position size, and asset filters. Alpha Lens handles the rest.
            </p>
          </motion.div>

          {/* Feature callouts */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="space-y-3 max-w-lg mx-auto">
            <div className="flex items-start gap-3 card p-4">
              <Zap size={18} className="text-[#34EAB9] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-[#F0FAF8]">Instant mirroring</p>
                <p className="text-xs text-white/55">Trades copied within seconds of the original</p>
              </div>
            </div>
            <div className="flex items-start gap-3 card p-4">
              <SlidersHorizontal size={18} className="text-[#34EAB9] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-[#F0FAF8]">Full risk control</p>
                <p className="text-xs text-white/55">Set allocation %, max size, asset filters, and delay window</p>
              </div>
            </div>
            <div className="flex items-start gap-3 card p-4">
              <BarChart3 size={18} className="text-[#34EAB9] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-[#F0FAF8]">Track your edge</p>
                <p className="text-xs text-white/55">See your copy trading PnL vs the original trader side by side</p>
              </div>
            </div>
          </motion.div>

          {/* Connect wallet CTA */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="text-center">
            <button
              onClick={connect}
              disabled={connecting}
              className="bg-[#34EAB9] text-[#0F1A1E] font-semibold px-8 py-3.5 rounded text-sm hover:bg-[#2BD4A6] transition-colors disabled:opacity-50"
            >
              {connecting ? 'Connecting...' : 'Connect Wallet'}
            </button>
            <p className="text-white/40 text-xs mt-3">
              Supports MetaMask, WalletConnect, and other EIP-1193 wallets
            </p>
          </motion.div>

          {/* Top Traders Preview — muted/blurred */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <h3 className="font-semibold text-sm mb-3 text-center">Top Traders Available to Copy</h3>
            <div className="relative">
              <div className="space-y-2 opacity-60 blur-[1px]">
                {previewWallets.map((w) => (
                  <div key={w.addr} className="card p-4 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#F0FAF8]">{w.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="font-mono text-[10px] text-white/40">{w.addr}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#34EAB9]/10 text-[#34EAB9]">{w.type}</span>
                      </div>
                    </div>
                    <div className="hidden sm:flex items-center gap-6 flex-shrink-0">
                      <div className="text-right">
                        <p className="font-mono text-sm font-semibold text-[#34EAB9]">{w.pnl}</p>
                        <p className="text-[9px] text-white/40">30d PnL</p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-sm text-[#F0FAF8]">{w.win}</p>
                        <p className="text-[9px] text-white/40">Win Rate</p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-sm text-[#F0FAF8]">{w.sharpe}</p>
                        <p className="text-[9px] text-white/40">Sharpe</p>
                      </div>
                    </div>
                    <div className="flex sm:hidden flex-col items-end flex-shrink-0">
                      <p className="font-mono text-sm font-semibold text-[#34EAB9]">{w.pnl}</p>
                      <p className="font-mono text-[10px] text-white/55">{w.win} · {w.sharpe}</p>
                    </div>
                  </div>
                ))}
              </div>
              {/* Overlay */}
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="text-white/60 text-sm font-medium bg-[#0F1A1E]/80 px-4 py-2 rounded">
                  Connect wallet to follow
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="px-4 py-4 lg:px-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold mb-1">Copy Trading</h2>
            <p className="text-white/55 text-xs">
              Auto-mirror positions from top traders &middot; Connected: {address.slice(0, 6)}...{address.slice(-4)}
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/performance"
              className="flex items-center gap-1.5 text-xs text-white/55 hover:text-[#34EAB9] transition-colors px-3 py-2"
            >
              <Shield size={14} />
              Performance
            </Link>
            <button
              onClick={() => setShowAdd(!showAdd)}
              className="flex items-center gap-1.5 bg-[#34EAB9] text-[#0F1A1E] text-xs font-semibold px-3 py-2 rounded"
            >
              <Plus size={14} />
              Add Trader
            </button>
          </div>
        </div>

        <AnimatePresence>
          {showAdd && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="card p-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-white/55 mb-1 block">Trader Wallet Address</label>
                    <input
                      value={newTarget}
                      onChange={e => setNewTarget(e.target.value)}
                      placeholder="0x..."
                      className="w-full bg-[#0F1A1E] border border-white/[0.08] rounded px-3 py-2.5 text-sm font-mono outline-none focus:border-[#34EAB9]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-white/55 mb-1 block">Label (optional)</label>
                    <input
                      value={newLabel}
                      onChange={e => setNewLabel(e.target.value)}
                      placeholder="e.g., Top Scalper"
                      className="w-full bg-[#0F1A1E] border border-white/[0.08] rounded px-3 py-2.5 text-sm outline-none focus:border-[#34EAB9]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-white/55 mb-1 block">Copy Ratio (%)</label>
                    <input
                      type="range"
                      min="5"
                      max="100"
                      step="5"
                      value={newRatio}
                      onChange={e => setNewRatio(Number(e.target.value))}
                      className="w-full accent-[#34EAB9]"
                    />
                    <div className="flex justify-between text-[10px] text-white/40 mt-1">
                      <span>Conservative</span>
                      <span className="font-mono text-[#34EAB9] font-bold">{newRatio}%</span>
                      <span>Full mirror</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-white/55 mb-1 block">Max Position (USD)</label>
                    <input
                      type="number"
                      value={newMaxSize}
                      onChange={e => setNewMaxSize(Number(e.target.value))}
                      className="w-full bg-[#0F1A1E] border border-white/[0.08] rounded px-3 py-2.5 text-sm outline-none focus:border-[#34EAB9]"
                    />
                  </div>
                </div>

                {/* Delay mode */}
                <div>
                  <label className="text-xs text-white/55 mb-2 block flex items-center gap-1.5">
                    <Clock size={12} />
                    Mirror Delay
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {DELAY_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setNewDelay(opt.value)}
                        className={`p-2 rounded text-center transition-colors ${
                          newDelay === opt.value
                            ? 'bg-[#34EAB9] text-[#0F1A1E]'
                            : 'bg-[#0F1A1E] text-white/55 hover:border-[#34EAB9]'
                        }`}
                      >
                        <p className="text-xs font-semibold">{opt.label}</p>
                        <p className="text-[9px] opacity-70">{opt.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Asset category filters */}
                <div>
                  <label className="text-xs text-white/55 mb-2 block">Asset Categories</label>
                  <div className="flex flex-wrap gap-1.5">
                    {ASSET_CATEGORIES.map(cat => (
                      <button
                        key={cat}
                        onClick={() => toggleCategory(cat)}
                        className={`text-[10px] px-2.5 py-1 rounded-full transition-colors ${
                          newCategories.includes(cat) || (cat === 'All' && newCategories.includes('All'))
                            ? 'bg-[#34EAB9] text-[#0F1A1E] font-semibold'
                            : 'bg-[#0F1A1E] text-white/55'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Excluded assets */}
                <div>
                  <label className="text-xs text-white/55 mb-1 block">Exclude Specific Assets (comma-separated)</label>
                  <input
                    value={newExcluded}
                    onChange={e => setNewExcluded(e.target.value)}
                    placeholder="e.g., DOGE, SHIB, PEPE"
                    className="w-full bg-[#0F1A1E] border border-white/[0.08] rounded px-3 py-2.5 text-sm outline-none focus:border-[#34EAB9]"
                  />
                </div>

                <div className="flex gap-2 pt-1">
                  <button onClick={addConfig} className="bg-[#34EAB9] text-[#0F1A1E] text-sm font-semibold px-5 py-2.5 rounded hover:brightness-110 transition-all">
                    Start Copying
                  </button>
                  <button onClick={() => { setShowAdd(false); resetForm() }} className="text-white/55 text-sm px-4 py-2">
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {loading ? (
          <div className="space-y-3">
            {[1, 2].map(i => (
              <div key={i} className="card p-4 animate-pulse">
                <div className="h-4 bg-[#0F1A1E] rounded w-1/3 mb-2" />
                <div className="h-3 bg-[#0F1A1E] rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : configs.length > 0 ? (
          <div className="space-y-3">
            {configs.map((c, i) => {
              const isExpanded = expandedConfig === c.target_address
              return (
                <motion.div
                  key={c.target_address}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="card p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Copy size={14} className="text-[#34EAB9]" />
                      <div>
                        <div className="flex items-center gap-2">
                          {c.label && <span className="text-sm font-semibold">{c.label}</span>}
                          <span className="font-mono text-sm text-white/55">
                            {c.target_address.slice(0, 6)}...{c.target_address.slice(-4)}
                          </span>
                          <Link href={`/wallet/${c.target_address}`}>
                            <ExternalLink size={12} className="text-white/55 hover:text-[#34EAB9]" />
                          </Link>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setExpandedConfig(isExpanded ? null : c.target_address)}>
                        <ChevronDown size={14} className={`text-white/55 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </button>
                      <button onClick={() => toggleConfig(c.target_address, !c.enabled)}>
                        {c.enabled ? (
                          <ToggleRight size={24} className="text-[#34EAB9]" />
                        ) : (
                          <ToggleLeft size={24} className="text-white/55" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3 text-xs text-white/55">
                    <span>Ratio: <span className="font-mono text-[#F0FAF8]">{c.ratio}%</span></span>
                    <span>Max: <span className="font-mono text-[#F0FAF8]">${c.max_position_size.toLocaleString()}</span></span>
                    <span>Delay: <span className="font-mono text-[#F0FAF8]">{c.delay_seconds === 0 ? 'Instant' : `${c.delay_seconds}s`}</span></span>
                    <span>Status: <span className={c.enabled ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}>{c.enabled ? 'Active' : 'Paused'}</span></span>
                  </div>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-3 pt-3 border-t border-white/[0.06] space-y-2">
                          <div>
                            <span className="text-[10px] text-white/40">Asset Filters: </span>
                            <span className="text-xs text-[#F0FAF8]">
                              {c.included_categories.join(', ') || 'All'}
                            </span>
                          </div>
                          {c.excluded_assets.length > 0 && (
                            <div>
                              <span className="text-[10px] text-white/40">Excluded: </span>
                              <span className="text-xs text-[#FF3B5C]">
                                {c.excluded_assets.join(', ')}
                              </span>
                            </div>
                          )}
                          <div className="flex gap-2 mt-2">
                            <Link
                              href={`/wallet/${c.target_address}`}
                              className="text-[10px] text-white/55 hover:text-[#34EAB9] transition-colors"
                            >
                              View Profile
                            </Link>
                            <Link
                              href={`/performance`}
                              className="text-[10px] text-white/55 hover:text-[#34EAB9] transition-colors"
                            >
                              See Performance
                            </Link>
                          </div>
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
            <Copy size={24} className="mx-auto mb-3 text-white/55" />
            <p className="text-white/55 text-sm mb-2">No copy trades configured</p>
            <p className="text-white/40 text-xs">
              Find a trader on the{' '}
              <Link href="/hunters" className="text-[#34EAB9]">Alpha Hunters</Link>
              {' '}page and add them here, or browse{' '}
              <Link href="/smart-money" className="text-[#34EAB9]">Smart Money</Link>
              {' '}for inspiration
            </p>
          </div>
        )}

        <div className="card p-4">
          <h3 className="font-semibold text-sm mb-2">How Copy Trading Works</h3>
          <div className="space-y-2 text-xs text-white/55">
            <p>1. Find profitable traders on the Alpha Hunters leaderboard or Smart Money page</p>
            <p>2. Set your copy ratio, max position size, and mirror delay</p>
            <p>3. Filter by asset categories — only copy what you&apos;re comfortable with</p>
            <p>4. Use the delay to review trades before they execute</p>
            <p>5. Track results on the <Link href="/performance" className="text-[#34EAB9]">Performance</Link> page</p>
          </div>
        </div>
      </div>
    </div>
  )
}
