'use client'
import { useState, useEffect, useCallback } from 'react'
import { OneClickStrategies } from '@/components/quant/OneClickStrategies'
import { SimpleRuleBuilder } from '@/components/quant/SimpleRuleBuilder'
import { BacktestResult, type BacktestSignal } from '@/components/quant/BacktestResult'
import { motion } from 'framer-motion'
import { Trash2, Pause, Play, Loader2 } from 'lucide-react'
import { runBacktest, type Candle, type BacktestConfig } from '@/lib/backtest/engine'

type Tab = 'backtester' | 'templates' | 'builder' | 'active'

type StrategyType = 'momentum' | 'mean_reversion'

interface SavedRule {
  id: string
  name: string
  conditions: Record<string, unknown>
  isActive: boolean
  createdAt: number
}

export default function QuantPage() {
  const [tab, setTab] = useState<Tab>('backtester')
  const [savedRules, setSavedRules] = useState<SavedRule[]>([])

  // Templates are wallet-event strategies; the client sandbox engine only
  // evaluates price-indicator rules, so template backtests show an honest
  // notice instead of results. No fabrication, ever.
  const [templateNotice, setTemplateNotice] = useState('')

  // Real backtester state
  const [markets, setMarkets] = useState<string[]>([])
  const [selectedMarket, setSelectedMarket] = useState('BTC')
  const [strategy, setStrategy] = useState<StrategyType>('momentum')
  const [positionSize, setPositionSize] = useState('10000')
  const [daysBack, setDaysBack] = useState(30)
  const [running, setRunning] = useState(false)
  const [backtestError, setBacktestError] = useState('')
  const [backtestResult, setBacktestResult] = useState<{
    strategyName: string
    data: Array<{ date: string; pnl: number }>
    totalPnl: number
    winRate: number
    tradeCount: number
    sharpe: number
    maxDrawdown: number
    signals: BacktestSignal[]
  } | null>(null)

  // Fetch available markets on mount
  useEffect(() => {
    fetch('/api/quant/backtest')
      .then(res => res.json())
      .then(data => {
        if (data.markets?.length > 0) setMarkets(data.markets)
      })
      .catch(() => {
        setMarkets(['BTC', 'ETH', 'SOL', 'HYPE', 'SUI', 'ARB', 'DOGE', 'WIF', 'AVAX', 'LINK'])
      })
  }, [])

  const runRealBacktest = useCallback(async () => {
    setRunning(true)
    setBacktestError('')
    setBacktestResult(null)

    const endTime = Date.now()
    const startTime = endTime - daysBack * 86400000

    try {
      // Fetch candle data from API
      const res = await fetch('/api/quant/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coin: selectedMarket,
          startTime,
          endTime,
          interval: '1h',
        }),
      })

      if (!res.ok) throw new Error('Failed to fetch candle data')
      const { candles, count } = await res.json()

      if (!candles || count === 0) {
        throw new Error(`No candle data returned for ${selectedMarket}`)
      }

      // Run backtest engine client-side
      const config: BacktestConfig = {
        strategy,
        positionSizeUsd: parseFloat(positionSize) || 10000,
        takerFeePct: 0.035,
      }

      const result = runBacktest(candles as Candle[], config)

      const strategyLabel = strategy === 'momentum'
        ? `EMA(20) Momentum — ${selectedMarket}`
        : `RSI(14) Mean Reversion — ${selectedMarket}`

      // Convert trades to BacktestSignal format for the result component
      const signals: BacktestSignal[] = result.trades.map(t => ({
        date: new Date(t.entryTime).toISOString().split('T')[0],
        asset: selectedMarket,
        direction: t.side,
        entry: Math.round(t.entryPrice * 100) / 100,
        exit: Math.round(t.exitPrice * 100) / 100,
        pnl: t.pnl,
      }))

      setBacktestResult({
        strategyName: strategyLabel,
        data: result.equityCurve,
        totalPnl: result.totalPnl,
        winRate: result.winRate,
        tradeCount: result.tradeCount,
        sharpe: result.sharpe,
        maxDrawdown: result.maxDrawdown,
        signals,
      })

      if (process.env.NODE_ENV === 'development') {
        console.log(`[Backtest] ${strategyLabel}: ${count} candles, ${result.tradeCount} trades, PnL: $${result.totalPnl}`)
      }
    } catch (err) {
      setBacktestError(err instanceof Error ? err.message : 'Backtest failed')
    } finally {
      setRunning(false)
    }
  }, [selectedMarket, strategy, positionSize, daysBack])

  // Template strategies are driven by wallet events (whale entries,
  // convergence, funding) — data the client sandbox does not have. The old
  // handler fabricated results with Math.random; now it tells the truth.
  const handleTemplateBacktest = (template: Record<string, unknown>) => {
    setTemplateNotice(
      `"${template.name}" is not yet testable in sandbox: wallet-event ` +
      'strategies need the server-side verification engine (in development). ' +
      'The Backtester tab runs real price-indicator strategies today.'
    )
  }

  const handleTemplateActivate = (template: Record<string, unknown>) => {
    const rule: SavedRule = {
      id: `rule_${Date.now()}`, name: template.name as string,
      conditions: template.conditions as Record<string, unknown>,
      isActive: true, createdAt: Date.now(),
    }
    setSavedRules(prev => [...prev, rule])
    setTab('active')
  }

  const handleRuleSave = (rule: Record<string, unknown>) => {
    const saved: SavedRule = {
      id: `rule_${Date.now()}`, name: rule.name as string,
      conditions: { walletConds: rule.walletConds, marketConds: rule.marketConds },
      isActive: true, createdAt: Date.now(),
    }
    setSavedRules(prev => [...prev, saved])
    setTab('active')
  }

  const toggleRule = (id: string) => {
    setSavedRules(prev => prev.map(r => r.id === id ? { ...r, isActive: !r.isActive } : r))
  }

  const deleteRule = (id: string) => {
    setSavedRules(prev => prev.filter(r => r.id !== id))
  }

  const activeCount = savedRules.filter(r => r.isActive).length

  return (
    <div>
      <div className="px-4 py-4 lg:px-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold mb-1">Pocket Quant Builder</h2>
          <p className="text-white/55 text-xs">Backtest strategies against real Hyperliquid data. No code needed.</p>
        </div>

        <div className="flex gap-2">
          {(['backtester', 'templates', 'builder', 'active'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                tab === t ? 'bg-[#34EAB9] text-[#0F1A1E]' : 'bg-[#0F1A1E] text-white/55'
              }`}
            >
              {t === 'backtester' ? 'Backtester' : t === 'templates' ? 'Templates' : t === 'builder' ? 'Custom' : `Active (${activeCount})`}
            </button>
          ))}
        </div>

        {tab === 'backtester' && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            {/* Strategy Configuration */}
            <div className="card p-4 space-y-3">
              <h3 className="text-sm font-semibold">Strategy Configuration</h3>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-white/40 block mb-1">Market</label>
                  <select
                    value={selectedMarket}
                    onChange={e => setSelectedMarket(e.target.value)}
                    className="w-full bg-[#0F1A1E] border border-white/[0.12] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#34EAB9]"
                  >
                    {(markets.length > 0 ? markets : ['BTC', 'ETH', 'SOL']).map(m => (
                      <option key={m} value={m}>{m}-PERP</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs text-white/40 block mb-1">Strategy</label>
                  <select
                    value={strategy}
                    onChange={e => setStrategy(e.target.value as StrategyType)}
                    className="w-full bg-[#0F1A1E] border border-white/[0.12] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#34EAB9]"
                  >
                    <option value="momentum">Momentum (EMA 20)</option>
                    <option value="mean_reversion">Mean Reversion (RSI 14)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-white/40 block mb-1">Position Size (USD)</label>
                  <input
                    type="number"
                    value={positionSize}
                    onChange={e => setPositionSize(e.target.value)}
                    min="100"
                    step="1000"
                    className="w-full bg-[#0F1A1E] border border-white/[0.12] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#34EAB9] font-mono"
                  />
                </div>

                <div>
                  <label className="text-xs text-white/40 block mb-1">Time Range</label>
                  <div className="flex gap-1">
                    {[7, 30, 90].map(d => (
                      <button
                        key={d}
                        onClick={() => setDaysBack(d)}
                        className={`flex-1 text-[10px] font-mono py-2 rounded transition-colors ${
                          daysBack === d
                            ? 'bg-[#34EAB9] text-[#0F1A1E] font-semibold'
                            : 'bg-[#0F1A1E] text-white/55 border border-white/[0.12] hover:border-white/[0.24]'
                        }`}
                      >
                        {d}D
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="pt-1">
                <p className="text-[10px] text-white/30 mb-2">
                  {strategy === 'momentum'
                    ? 'Enter long when close > EMA(20), exit when close < EMA(20). Uses 1h candles.'
                    : 'Enter long when RSI(14) < 30 (oversold), exit when RSI(14) > 50 (mean reversion). Uses 1h candles.'}
                  {' '}Taker fee: 0.035% per trade.
                </p>
                <button
                  onClick={runRealBacktest}
                  disabled={running}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded text-sm font-semibold bg-[#34EAB9] text-[#0F1A1E] hover:brightness-110 transition-all disabled:opacity-50"
                >
                  {running ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Running Backtest...
                    </>
                  ) : (
                    <>
                      <Play size={16} />
                      Run Backtest
                    </>
                  )}
                </button>
              </div>
            </div>

            {backtestError && (
              <div className="card p-4 text-center">
                <p className="text-[#FF3B5C] text-sm">{backtestError}</p>
              </div>
            )}

            {backtestResult && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                <BacktestResult {...backtestResult} />
              </motion.div>
            )}
          </motion.div>
        )}

        {tab === 'templates' && (
          <div className="space-y-4">
            <OneClickStrategies onSelect={handleTemplateBacktest} onActivate={handleTemplateActivate} />
            {templateNotice && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="card p-4">
                <p className="text-xs text-amber-400/90">{templateNotice}</p>
              </motion.div>
            )}
          </div>
        )}

        {tab === 'builder' && <SimpleRuleBuilder onSave={handleRuleSave} />}

        {tab === 'active' && (
          <div className="space-y-3">
            {savedRules.length === 0 ? (
              <div className="text-center py-12">
                <h3 className="text-[#F0FAF8] text-base font-semibold mb-2">No active strategies yet.</h3>
                <p className="text-white/40 text-sm mb-6">Saved rules store your configuration. Paper tracking arrives with the verification engine.</p>
                <div className="flex gap-3 justify-center">
                  <button onClick={() => setTab('templates')} className="text-sm font-semibold bg-[#34EAB9] text-[#0F1A1E] px-5 py-2.5 rounded hover:brightness-110 transition-all">
                    Browse Templates
                  </button>
                  <button onClick={() => setTab('builder')} className="text-sm font-medium text-white/55 px-5 py-2.5 rounded border border-white/[0.12] hover:border-white/[0.24] transition-colors">
                    Build Custom
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="card p-3 bg-[#0F1A1E]">
                  <div className="flex items-center justify-between text-xs text-white/55">
                    <span>{activeCount} active / {savedRules.length} total rules</span>
                    <span className="text-white/40">Paper tracking coming with the verification engine</span>
                  </div>
                </div>
                {savedRules.map((rule) => (
                  <motion.div
                    key={rule.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`card p-4 transition-all ${rule.isActive ? '' : 'opacity-60'}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${rule.isActive ? 'bg-[#34EAB9] pulse-accent' : 'bg-white/40'}`} />
                        <p className="font-semibold text-sm">{rule.name}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleRule(rule.id)}
                          className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors text-white/55 hover:text-[#F0FAF8]"
                          title={rule.isActive ? 'Pause' : 'Resume'}
                        >
                          {rule.isActive ? <Pause size={14} /> : <Play size={14} />}
                        </button>
                        <button
                          onClick={() => deleteRule(rule.id)}
                          className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors text-white/55 hover:text-[#FF3B5C]"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="flex gap-4 text-xs text-white/55">
                      <span>{rule.isActive ? 'Saved (active)' : 'Saved (paused)'}</span>
                      <span className="text-white/40">Configuration only — no live tracking yet</span>
                    </div>
                    <div className="mt-2 text-xs text-white/40">
                      Created {new Date(rule.createdAt).toLocaleDateString()}
                    </div>
                  </motion.div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
