'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useWallet } from '@/lib/wallet/WalletContext'
import { BarChart3, TrendingUp, Activity, Clock, Target, ArrowUpRight, ArrowDownRight, DollarSign, Loader2 } from 'lucide-react'
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

type TimeRange = 7 | 30 | 90

interface DailyPnl {
  date: string
  pnl: number
  cumulative: number
}

interface AssetBreakdown {
  coin: string
  pnl: number
  trades: number
  volume: number
}

interface TradeStats {
  totalTrades: number
  winRate: number
  avgTradeSizeUsd: number
  largestWin: number
  largestLoss: number
  avgHoldTimeSeconds: number
  profitFactor: number
  grossProfit: number
  grossLoss: number
}

interface FundingSummary {
  total: number
  received: number
  paid: number
  count: number
}

interface PerformanceData {
  dailyPnl: DailyPnl[]
  stats: TradeStats
  assetBreakdown: AssetBreakdown[]
  funding: FundingSummary
}

function formatUsd(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `$${(abs / 1e3).toFixed(1)}K`
  return `$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function formatHoldTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`
  return `${(seconds / 86400).toFixed(1)}d`
}

interface CaptureStatus {
  live: boolean
  lastHeartbeat: string | null
  captureSince: string | null
  walletsTracked: number | null
}

export default function PerformancePage() {
  const { address, connect, connecting } = useWallet()
  const [range, setRange] = useState<TimeRange>(30)
  const [data, setData] = useState<PerformanceData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [capture, setCapture] = useState<CaptureStatus | null>(null)

  useEffect(() => {
    fetch('/api/capture/health')
      .then(r => r.json())
      .then(setCapture)
      .catch(() => setCapture({ live: false, lastHeartbeat: null, captureSince: null, walletsTracked: null }))
  }, [])

  const fetchData = useCallback(async (addr: string, days: TimeRange) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/performance?address=${addr}&days=${days}`)
      if (!res.ok) throw new Error('Failed to load performance data')
      const json = await res.json()
      setData({
        dailyPnl: json.dailyPnl || [],
        stats: json.stats || { totalTrades: 0, winRate: 0, avgTradeSizeUsd: 0, largestWin: 0, largestLoss: 0, avgHoldTimeSeconds: 0, profitFactor: 0, grossProfit: 0, grossLoss: 0 },
        assetBreakdown: json.assetBreakdown || [],
        funding: json.funding || { total: 0, received: 0, paid: 0, count: 0 },
      })
    } catch {
      setError('Failed to load performance data. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (address) fetchData(address, range)
  }, [address, range, fetchData])

  if (!address) {
    // Honest empty state: no fabricated numbers. Shows the real status of the
    // forward-capture pipeline (capture_health heartbeats) and nothing else.
    const sinceDate = capture?.captureSince
      ? new Date(capture.captureSince).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
      : null
    const lastBeat = capture?.lastHeartbeat
      ? new Date(capture.lastHeartbeat).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : null
    return (
      <div>
        <div className="px-4 py-16 text-center">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <div className="w-16 h-16 mx-auto mb-4 rounded-lg bg-[#0F1A1E] flex items-center justify-center">
              <BarChart3 size={28} className="text-[#34EAB9]" />
            </div>
            <h2 className="text-lg font-bold mb-2">Forward tracking begins from live capture</h2>
            <p className="text-white/55 text-sm mb-6 max-w-sm mx-auto">
              Performance here is computed only from data we actually captured.
              Connect a wallet to view its real Hyperliquid trading history.
            </p>

            {/* Real capture status — reads capture_health, never invents */}
            <div className="card p-4 max-w-sm mx-auto mb-6 text-left">
              <div className="flex items-center gap-2 mb-3">
                <span className={`w-2 h-2 rounded-full ${capture?.live ? 'bg-[#34EAB9] animate-pulse' : 'bg-[#FF3B5C]'}`} />
                <span className="text-xs font-semibold">
                  {capture === null ? 'Checking capture status…' : capture.live ? 'Capture running' : 'Capture offline'}
                </span>
              </div>
              <div className="space-y-1.5 text-xs text-white/55">
                <div className="flex justify-between">
                  <span>Capturing since</span>
                  <span className="font-mono text-white/80">{sinceDate ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Last heartbeat</span>
                  <span className="font-mono text-white/80">{lastBeat ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Wallets tracked</span>
                  <span className="font-mono text-white/80">
                    {capture?.walletsTracked != null ? capture.walletsTracked.toLocaleString() : '—'}
                  </span>
                </div>
              </div>
            </div>

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

  const totalPnl = data ? data.dailyPnl.reduce((s, d) => s + d.pnl, 0) : 0
  const cumulativeEnd = data?.dailyPnl.length ? data.dailyPnl[data.dailyPnl.length - 1].cumulative : 0

  return (
    <div>
      <div className="px-4 py-4 lg:px-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold mb-1">Performance</h2>
            <p className="text-white/55 text-xs">
              Live trading performance from Hyperliquid
            </p>
          </div>
          {/* Time range selector */}
          <div className="flex gap-1">
            {([7, 30, 90] as TimeRange[]).map(d => (
              <button
                key={d}
                onClick={() => setRange(d)}
                className={`text-[10px] font-mono px-2.5 py-1 rounded transition-colors ${
                  range === d
                    ? 'bg-[#34EAB9] text-[#0F1A1E] font-semibold'
                    : 'bg-[#0F1A1E] text-white/55 hover:text-white/80'
                }`}
              >
                {d}D
              </button>
            ))}
          </div>
        </div>

        {loading && !data && (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-[#34EAB9]" />
            <span className="text-white/55 text-sm ml-2">Loading performance data...</span>
          </div>
        )}

        {error && (
          <div className="card p-4 text-center">
            <p className="text-[#FF3B5C] text-sm">{error}</p>
          </div>
        )}

        {data && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            {/* Summary stats */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="card p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <TrendingUp size={12} className="text-[#34EAB9]" />
                  <span className="text-[10px] text-white/40">Trading PnL</span>
                </div>
                <p className={`font-mono font-bold text-lg ${cumulativeEnd >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                  {cumulativeEnd >= 0 ? '+' : '-'}{formatUsd(cumulativeEnd)}
                </p>
              </div>
              <div className="card p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <BarChart3 size={12} className="text-[#34EAB9]" />
                  <span className="text-[10px] text-white/40">Win Rate</span>
                </div>
                <p className="font-mono font-bold text-lg">{(data.stats.winRate * 100).toFixed(0)}%</p>
              </div>
              <div className="card p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Activity size={12} className="text-[#34EAB9]" />
                  <span className="text-[10px] text-white/40">Total Trades</span>
                </div>
                <p className="font-mono font-bold text-lg">{data.stats.totalTrades}</p>
              </div>
              <div className="card p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <DollarSign size={12} className="text-[#34EAB9]" />
                  <span className="text-[10px] text-white/40">Funding PnL</span>
                </div>
                <p className={`font-mono font-bold text-lg ${data.funding.total >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                  {data.funding.total >= 0 ? '+' : '-'}{formatUsd(data.funding.total)}
                </p>
              </div>
            </div>

            {/* Cumulative PnL Chart */}
            {data.dailyPnl.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="card p-4">
                <h3 className="text-sm font-semibold mb-3">Cumulative PnL ({range}D)</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={data.dailyPnl} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="perfPnlGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={cumulativeEnd >= 0 ? '#34EAB9' : '#FF3B5C'} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={cumulativeEnd >= 0 ? '#34EAB9' : '#FF3B5C'} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="date"
                      tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(val) => {
                        const d = new Date(val)
                        return `${d.getMonth() + 1}/${d.getDate()}`
                      }}
                    />
                    <YAxis
                      tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(val) => `$${Math.abs(val) >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0F1A1E',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '12px',
                        fontSize: '12px',
                      }}
                      labelStyle={{ color: 'rgba(255,255,255,0.55)' }}
                      formatter={(value: number) => [`${value >= 0 ? '+' : '-'}$${Math.abs(value).toLocaleString()}`, 'Cumulative PnL']}
                    />
                    <Area
                      type="monotone"
                      dataKey="cumulative"
                      stroke={cumulativeEnd >= 0 ? '#34EAB9' : '#FF3B5C'}
                      strokeWidth={2}
                      fill="url(#perfPnlGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </motion.div>
            )}

            {/* Trade Statistics */}
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="card p-4">
              <h3 className="text-sm font-semibold mb-3">Trade Statistics</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="bg-[#0F1A1E] rounded p-2.5 text-center">
                  <p className="text-[9px] text-white/40 mb-0.5">Avg Trade Size</p>
                  <p className="font-mono font-semibold text-sm">{formatUsd(data.stats.avgTradeSizeUsd)}</p>
                </div>
                <div className="bg-[#0F1A1E] rounded p-2.5 text-center">
                  <p className="text-[9px] text-white/40 mb-0.5">Profit Factor</p>
                  <p className="font-mono font-semibold text-sm">
                    {data.stats.profitFactor === Infinity ? '∞' : data.stats.profitFactor.toFixed(2)}
                  </p>
                </div>
                <div className="bg-[#0F1A1E] rounded p-2.5 text-center">
                  <p className="text-[9px] text-white/40 mb-0.5">Largest Win</p>
                  <p className="font-mono font-semibold text-sm text-[#34EAB9]">+{formatUsd(data.stats.largestWin)}</p>
                </div>
                <div className="bg-[#0F1A1E] rounded p-2.5 text-center">
                  <p className="text-[9px] text-white/40 mb-0.5">Largest Loss</p>
                  <p className="font-mono font-semibold text-sm text-[#FF3B5C]">-{formatUsd(Math.abs(data.stats.largestLoss))}</p>
                </div>
                <div className="bg-[#0F1A1E] rounded p-2.5 text-center">
                  <p className="text-[9px] text-white/40 mb-0.5">Avg Hold Time</p>
                  <p className="font-mono font-semibold text-sm">{formatHoldTime(data.stats.avgHoldTimeSeconds)}</p>
                </div>
                <div className="bg-[#0F1A1E] rounded p-2.5 text-center">
                  <p className="text-[9px] text-white/40 mb-0.5">Gross Profit</p>
                  <p className="font-mono font-semibold text-sm text-[#34EAB9]">+{formatUsd(data.stats.grossProfit)}</p>
                </div>
                <div className="bg-[#0F1A1E] rounded p-2.5 text-center">
                  <p className="text-[9px] text-white/40 mb-0.5">Gross Loss</p>
                  <p className="font-mono font-semibold text-sm text-[#FF3B5C]">-{formatUsd(data.stats.grossLoss)}</p>
                </div>
                <div className="bg-[#0F1A1E] rounded p-2.5 text-center">
                  <p className="text-[9px] text-white/40 mb-0.5">Win Rate</p>
                  <p className="font-mono font-semibold text-sm">{(data.stats.winRate * 100).toFixed(1)}%</p>
                </div>
              </div>
            </motion.div>

            {/* Asset Breakdown */}
            {data.assetBreakdown.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="card p-4">
                <h3 className="text-sm font-semibold mb-3">PnL by Asset</h3>
                {data.assetBreakdown.length > 2 && (
                  <div className="mb-4">
                    <ResponsiveContainer width="100%" height={160}>
                      <BarChart data={data.assetBreakdown.slice(0, 10)} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                        <XAxis
                          dataKey="coin"
                          tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 10 }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 10 }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(val) => `$${Math.abs(val) >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}`}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#0F1A1E',
                            border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: '12px',
                            fontSize: '12px',
                          }}
                          formatter={(value: number) => [`${value >= 0 ? '+' : '-'}$${Math.abs(value).toLocaleString()}`, 'PnL']}
                        />
                        <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                          {data.assetBreakdown.slice(0, 10).map((entry, i) => (
                            <Cell key={i} fill={entry.pnl >= 0 ? '#34EAB9' : '#FF3B5C'} fillOpacity={0.8} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <div className="space-y-1.5">
                  {data.assetBreakdown.map((asset, i) => (
                    <div key={asset.coin} className="flex items-center justify-between py-1.5 px-2 rounded bg-white/[0.03]">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold w-5 text-white/30">#{i + 1}</span>
                        <span className="text-xs font-semibold">{asset.coin}</span>
                        <span className="text-[10px] text-white/40">{asset.trades} trades</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] text-white/40 font-mono">Vol {formatUsd(asset.volume)}</span>
                        <span className={`text-xs font-mono font-semibold ${asset.pnl >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                          {asset.pnl >= 0 ? '+' : '-'}{formatUsd(asset.pnl)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Funding Income */}
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="card p-4">
              <h3 className="text-sm font-semibold mb-3">Funding Income ({range}D)</h3>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-[#0F1A1E] rounded p-2.5 text-center">
                  <p className="text-[9px] text-white/40 mb-0.5">Net Funding</p>
                  <p className={`font-mono font-semibold ${data.funding.total >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                    {data.funding.total >= 0 ? '+' : '-'}{formatUsd(data.funding.total)}
                  </p>
                </div>
                <div className="bg-[#0F1A1E] rounded p-2.5 text-center">
                  <p className="text-[9px] text-white/40 mb-0.5">Received</p>
                  <p className="font-mono font-semibold text-[#34EAB9]">+{formatUsd(data.funding.received)}</p>
                </div>
                <div className="bg-[#0F1A1E] rounded p-2.5 text-center">
                  <p className="text-[9px] text-white/40 mb-0.5">Paid</p>
                  <p className="font-mono font-semibold text-[#FF3B5C]">-{formatUsd(data.funding.paid)}</p>
                </div>
              </div>
              <p className="text-[10px] text-white/30 mt-2 text-center">{data.funding.count} funding events</p>
            </motion.div>

            {/* Daily PnL breakdown */}
            {data.dailyPnl.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="card p-4">
                <h3 className="text-sm font-semibold mb-3">Daily PnL</h3>
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={data.dailyPnl} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                    <XAxis
                      dataKey="date"
                      tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(val) => {
                        const d = new Date(val)
                        return `${d.getMonth() + 1}/${d.getDate()}`
                      }}
                    />
                    <YAxis
                      tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(val) => `$${Math.abs(val) >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0F1A1E',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '12px',
                        fontSize: '12px',
                      }}
                      formatter={(value: number) => [`${value >= 0 ? '+' : '-'}$${Math.abs(value).toLocaleString()}`, 'Daily PnL']}
                    />
                    <Bar dataKey="pnl" radius={[2, 2, 0, 0]}>
                      {data.dailyPnl.map((entry, i) => (
                        <Cell key={i} fill={entry.pnl >= 0 ? '#34EAB9' : '#FF3B5C'} fillOpacity={0.7} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </motion.div>
            )}

            {data.stats.totalTrades === 0 && (
              <div className="card p-6 text-center">
                <p className="text-white/55 text-sm">No trades found in the last {range} days</p>
              </div>
            )}
          </motion.div>
        )}
      </div>
    </div>
  )
}
