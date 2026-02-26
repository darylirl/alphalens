'use client'
import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { useWallet } from '@/lib/wallet/WalletContext'
import { BarChart3, TrendingUp, Users, Clock, Wallet, ArrowUpRight, ArrowDownRight, ExternalLink } from 'lucide-react'

interface FollowedTrade {
  id: string
  sourceWallet: string
  sourceLabel?: string
  asset: string
  side: 'Long' | 'Short'
  sourceEntry: number
  yourEntry: number
  sourceExit: number | null
  yourExit: number | null
  sourceSize: number
  yourSize: number
  sourcePnl: number
  yourPnl: number
  openedAt: number
  closedAt: number | null
  status: 'open' | 'closed'
}

interface WalletAttribution {
  address: string
  label?: string
  totalTrades: number
  winRate: number
  totalPnl: number
  avgSlippage: number
  bestTrade: number
  worstTrade: number
}

// Demo data for the UI
const DEMO_TRADES: FollowedTrade[] = [
  {
    id: '1', sourceWallet: '0x7a23f1e9b4c5d2a891fe', sourceLabel: 'Alpha Hunter',
    asset: 'ETH', side: 'Long', sourceEntry: 3420, yourEntry: 3425, sourceExit: 3580, yourExit: 3575,
    sourceSize: 50000, yourSize: 5000, sourcePnl: 2340, yourPnl: 219,
    openedAt: Date.now() - 86400000 * 3, closedAt: Date.now() - 86400000, status: 'closed',
  },
  {
    id: '2', sourceWallet: '0x7a23f1e9b4c5d2a891fe', sourceLabel: 'Alpha Hunter',
    asset: 'BTC', side: 'Long', sourceEntry: 67200, yourEntry: 67250, sourceExit: 69100, yourExit: 69050,
    sourceSize: 100000, yourSize: 10000, sourcePnl: 2830, yourPnl: 267,
    openedAt: Date.now() - 86400000 * 7, closedAt: Date.now() - 86400000 * 5, status: 'closed',
  },
  {
    id: '3', sourceWallet: '0x3f8b22a4d1e7c9f05b33', sourceLabel: 'Yield Farmer',
    asset: 'SOL', side: 'Short', sourceEntry: 178, yourEntry: 177.5, sourceExit: 165, yourExit: 166,
    sourceSize: 30000, yourSize: 3000, sourcePnl: 2190, yourPnl: 195,
    openedAt: Date.now() - 86400000 * 10, closedAt: Date.now() - 86400000 * 8, status: 'closed',
  },
  {
    id: '4', sourceWallet: '0x7a23f1e9b4c5d2a891fe', sourceLabel: 'Alpha Hunter',
    asset: 'ETH', side: 'Long', sourceEntry: 3510, yourEntry: 3515, sourceExit: null, yourExit: null,
    sourceSize: 75000, yourSize: 7500, sourcePnl: 1200, yourPnl: 114,
    openedAt: Date.now() - 86400000, closedAt: null, status: 'open',
  },
  {
    id: '5', sourceWallet: '0xd1e4cc07a8b2f6539e71', sourceLabel: 'Scalper Pro',
    asset: 'ARB', side: 'Long', sourceEntry: 1.15, yourEntry: 1.16, sourceExit: 1.08, yourExit: 1.07,
    sourceSize: 20000, yourSize: 2000, sourcePnl: -1217, yourPnl: -155,
    openedAt: Date.now() - 86400000 * 2, closedAt: Date.now() - 86400000, status: 'closed',
  },
]

function formatUsd(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `$${(abs / 1e3).toFixed(1)}K`
  return `$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

export default function PerformancePage() {
  const { address, connect, connecting } = useWallet()
  const [tab, setTab] = useState<'overview' | 'trades' | 'wallets'>('overview')
  const trades = DEMO_TRADES

  const walletAttributions = useMemo<WalletAttribution[]>(() => {
    const byWallet: Record<string, FollowedTrade[]> = {}
    trades.forEach(t => {
      if (!byWallet[t.sourceWallet]) byWallet[t.sourceWallet] = []
      byWallet[t.sourceWallet].push(t)
    })

    return Object.entries(byWallet).map(([addr, wTrades]) => {
      const closed = wTrades.filter(t => t.status === 'closed')
      const wins = closed.filter(t => t.yourPnl > 0)
      const totalPnl = wTrades.reduce((s, t) => s + t.yourPnl, 0)
      const slippages = closed.map(t => Math.abs(t.yourEntry - t.sourceEntry) / t.sourceEntry * 100)
      return {
        address: addr,
        label: wTrades[0]?.sourceLabel,
        totalTrades: wTrades.length,
        winRate: closed.length > 0 ? wins.length / closed.length : 0,
        totalPnl,
        avgSlippage: slippages.length > 0 ? slippages.reduce((s, v) => s + v, 0) / slippages.length : 0,
        bestTrade: Math.max(...wTrades.map(t => t.yourPnl)),
        worstTrade: Math.min(...wTrades.map(t => t.yourPnl)),
      }
    }).sort((a, b) => b.totalPnl - a.totalPnl)
  }, [trades])

  const totalPnl = trades.reduce((s, t) => s + t.yourPnl, 0)
  const closedTrades = trades.filter(t => t.status === 'closed')
  const winRate = closedTrades.length > 0
    ? closedTrades.filter(t => t.yourPnl > 0).length / closedTrades.length
    : 0
  const openTrades = trades.filter(t => t.status === 'open')

  if (!address) {
    return (
      <div>
        <div className="px-4 py-16 text-center">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <div className="w-16 h-16 mx-auto mb-4 rounded-lg bg-[#0F1A1E] flex items-center justify-center">
              <BarChart3 size={28} className="text-[#34EAB9]" />
            </div>
            <h2 className="text-lg font-bold mb-2">Performance Attribution</h2>
            <p className="text-white/55 text-sm mb-6 max-w-sm mx-auto">
              Connect your wallet to track how Alpha Lens intelligence has impacted your trading performance.
            </p>
            <button
              onClick={connect}
              disabled={connecting}
              className="bg-[#34EAB9] text-[#0F1A1E] font-semibold px-6 py-3 rounded text-sm hover:bg-[#2BD4A6] transition-colors disabled:opacity-50"
            >
              {connecting ? 'Connecting...' : 'Connect Wallet'}
            </button>
          </motion.div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="px-4 py-4 lg:px-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold mb-1">Performance Attribution</h2>
          <p className="text-white/55 text-xs">
            Track your Alpha Lens-influenced trades &middot; See which wallets make you money
          </p>
        </div>

        <div className="flex gap-2">
          {(['overview', 'trades', 'wallets'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                tab === t ? 'bg-[#34EAB9] text-[#0F1A1E]' : 'bg-[#0F1A1E] text-white/55'
              }`}
            >
              {t === 'overview' ? 'Overview' : t === 'trades' ? 'Trade Log' : 'By Wallet'}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            {/* Summary stats */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="card p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <TrendingUp size={12} className="text-[#34EAB9]" />
                  <span className="text-[10px] text-white/40">Alpha Lens PnL</span>
                </div>
                <p className={`font-mono font-bold text-lg ${totalPnl >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                  {totalPnl >= 0 ? '+' : '-'}{formatUsd(totalPnl)}
                </p>
              </div>
              <div className="card p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <BarChart3 size={12} className="text-[#34EAB9]" />
                  <span className="text-[10px] text-white/40">Win Rate</span>
                </div>
                <p className="font-mono font-bold text-lg">{(winRate * 100).toFixed(0)}%</p>
              </div>
              <div className="card p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Users size={12} className="text-[#34EAB9]" />
                  <span className="text-[10px] text-white/40">Wallets Followed</span>
                </div>
                <p className="font-mono font-bold text-lg">{walletAttributions.length}</p>
              </div>
              <div className="card p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Clock size={12} className="text-[#34EAB9]" />
                  <span className="text-[10px] text-white/40">Open Trades</span>
                </div>
                <p className="font-mono font-bold text-lg">{openTrades.length}</p>
              </div>
            </div>

            {/* Top performing wallets */}
            <div>
              <h3 className="font-semibold text-sm mb-3">Your Most Profitable Sources</h3>
              <div className="space-y-2">
                {walletAttributions.slice(0, 3).map((w, i) => (
                  <motion.div
                    key={w.address}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="card p-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[#0F1A1E] flex items-center justify-center text-[#34EAB9] font-mono text-xs font-bold">
                          #{i + 1}
                        </div>
                        <div>
                          <Link href={`/wallet/${w.address}`} className="text-sm font-medium hover:text-[#34EAB9] transition-colors">
                            {w.label || `${w.address.slice(0, 6)}...${w.address.slice(-4)}`}
                          </Link>
                          <p className="text-[10px] text-white/40">
                            {w.totalTrades} trades &middot; {(w.winRate * 100).toFixed(0)}% win &middot; {w.avgSlippage.toFixed(2)}% avg slippage
                          </p>
                        </div>
                      </div>
                      <p className={`font-mono font-bold ${w.totalPnl >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                        {w.totalPnl >= 0 ? '+' : '-'}{formatUsd(w.totalPnl)}
                      </p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Recent open trades */}
            {openTrades.length > 0 && (
              <div>
                <h3 className="font-semibold text-sm mb-3">Currently Open</h3>
                <div className="space-y-2">
                  {openTrades.map(t => (
                    <div key={t.id} className="card p-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${t.side === 'Long' ? 'bg-[#34EAB9]' : 'bg-[#FF3B5C]'} pulse-accent`} />
                        <span className="font-bold text-sm">{t.asset}</span>
                        <span className={`text-[10px] font-semibold ${t.side === 'Long' ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                          {t.side}
                        </span>
                        <span className="text-[10px] text-white/40">via {t.sourceLabel}</span>
                      </div>
                      <p className={`font-mono text-sm font-semibold ${t.yourPnl >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                        {t.yourPnl >= 0 ? '+' : '-'}{formatUsd(t.yourPnl)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {tab === 'trades' && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
            {trades.map((t, i) => {
              const isLong = t.side === 'Long'
              const entrySlippage = Math.abs(t.yourEntry - t.sourceEntry) / t.sourceEntry * 100
              return (
                <motion.div
                  key={t.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="card p-4"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        {isLong ? <ArrowUpRight size={14} className="text-[#34EAB9]" /> : <ArrowDownRight size={14} className="text-[#FF3B5C]" />}
                        <span className="font-bold">{t.asset}</span>
                        <span className={`text-xs font-semibold ${isLong ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>{t.side}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${t.status === 'open' ? 'bg-[#34EAB920] text-[#34EAB9]' : 'bg-white/[0.06] text-white/55'}`}>
                          {t.status === 'open' ? 'OPEN' : 'CLOSED'}
                        </span>
                      </div>
                      <p className="text-[10px] text-white/40">
                        via {t.sourceLabel || `${t.sourceWallet.slice(0, 6)}...`} &middot; {new Date(t.openedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`font-mono font-bold ${t.yourPnl >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                        {t.yourPnl >= 0 ? '+' : '-'}{formatUsd(t.yourPnl)}
                      </p>
                      <p className="text-[9px] text-white/40">Your PnL</p>
                    </div>
                  </div>

                  {/* Comparison grid */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-[#0F1A1E] rounded p-2">
                      <p className="text-[9px] text-white/40 mb-1">Source Entry</p>
                      <p className="font-mono">${t.sourceEntry.toLocaleString()}</p>
                    </div>
                    <div className="bg-[#0F1A1E] rounded p-2">
                      <p className="text-[9px] text-white/40 mb-1">Your Entry</p>
                      <p className="font-mono">${t.yourEntry.toLocaleString()}</p>
                      <p className="text-[8px] text-white/40">{entrySlippage.toFixed(3)}% slippage</p>
                    </div>
                    <div className="bg-[#0F1A1E] rounded p-2">
                      <p className="text-[9px] text-white/40 mb-1">Source PnL</p>
                      <p className={`font-mono ${t.sourcePnl >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                        {t.sourcePnl >= 0 ? '+' : '-'}{formatUsd(t.sourcePnl)}
                      </p>
                    </div>
                    <div className="bg-[#0F1A1E] rounded p-2">
                      <p className="text-[9px] text-white/40 mb-1">Your PnL</p>
                      <p className={`font-mono ${t.yourPnl >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                        {t.yourPnl >= 0 ? '+' : '-'}{formatUsd(t.yourPnl)}
                      </p>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </motion.div>
        )}

        {tab === 'wallets' && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
            {walletAttributions.map((w, i) => (
              <motion.div
                key={w.address}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="card p-4"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Link href={`/wallet/${w.address}`} className="font-semibold hover:text-[#34EAB9] transition-colors">
                        {w.label || `${w.address.slice(0, 6)}...${w.address.slice(-4)}`}
                      </Link>
                      <ExternalLink size={12} className="text-white/40" />
                    </div>
                    <p className="text-[10px] text-white/40 mt-0.5">
                      {w.totalTrades} followed trades
                    </p>
                  </div>
                  <p className={`font-mono font-bold text-lg ${w.totalPnl >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                    {w.totalPnl >= 0 ? '+' : '-'}{formatUsd(w.totalPnl)}
                  </p>
                </div>

                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div className="bg-[#0F1A1E] rounded p-2 text-center">
                    <p className="text-[9px] text-white/40 mb-0.5">Win Rate</p>
                    <p className="font-mono font-semibold">{(w.winRate * 100).toFixed(0)}%</p>
                  </div>
                  <div className="bg-[#0F1A1E] rounded p-2 text-center">
                    <p className="text-[9px] text-white/40 mb-0.5">Avg Slippage</p>
                    <p className="font-mono font-semibold">{w.avgSlippage.toFixed(2)}%</p>
                  </div>
                  <div className="bg-[#0F1A1E] rounded p-2 text-center">
                    <p className="text-[9px] text-white/40 mb-0.5">Best</p>
                    <p className={`font-mono font-semibold ${w.bestTrade >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>{w.bestTrade >= 0 ? '+' : '-'}{formatUsd(w.bestTrade)}</p>
                  </div>
                  <div className="bg-[#0F1A1E] rounded p-2 text-center">
                    <p className="text-[9px] text-white/40 mb-0.5">Worst</p>
                    <p className={`font-mono font-semibold ${w.worstTrade >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>{w.worstTrade >= 0 ? '+' : '-'}{formatUsd(w.worstTrade)}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    </div>
  )
}
