'use client'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Play, Save } from 'lucide-react'
import { BacktestResult, type BacktestSignal } from './BacktestResult'
import { runBacktest, type Candle, type BacktestConfig } from '@/lib/backtest/engine'

// Honesty contract: the Run button either evaluates the rule with the REAL
// client engine on real candles (inheriting the sandbox label), or is
// disabled with "Not yet testable in sandbox". It never fabricates results.
//
// The sandbox engine evaluates price-indicator strategies only (EMA-20
// momentum, RSI-14 < 30 mean reversion). Wallet-event conditions (whale
// opens, convergence, archetype, confidence) need the server-side
// verification engine, which is not built yet.

const IF_OPTIONS = [
  { value: '', label: 'Select condition...' },
  { value: 'asset_eq', label: 'Asset =' },
  { value: 'whale_opens', label: 'Whale opens position' },
  { value: 'wallets_converge', label: '3+ wallets converge' },
  { value: 'archetype_eq', label: 'Wallet archetype =' },
  { value: 'confidence_gt', label: 'Confidence score >' },
]

const AND_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'rsi_lt', label: 'RSI(14) <' },
  { value: 'ema_trend', label: 'Price above EMA(20)' },
  { value: 'direction_eq', label: 'Direction =' },
  { value: 'leverage_gt', label: 'Leverage >' },
  { value: 'size_gt', label: 'Size >' },
  { value: 'funding_gt', label: 'Funding rate >' },
]

// "Mirror trade" removed: copy-trade execution was retired after our own
// backtests showed it loses money (see /learn).
const THEN_OPTIONS = [
  { value: '', label: 'Select action...' },
  { value: 'alert', label: 'Send alert' },
  { value: 'watchlist', label: 'Log to watchlist' },
]

// Canonical archetype vocabulary (lib/wallets/classify.ts)
const VALUE_SUGGESTIONS: Record<string, string[]> = {
  archetype_eq: ['market_maker', 'momentum_trader', 'basis_trader', 'whale', 'scalper', 'swing_trader'],
  asset_eq: ['BTC', 'ETH', 'SOL', 'HYPE', 'ARB', 'DOGE'],
  direction_eq: ['Long', 'Short'],
  confidence_gt: ['5', '7', '8'],
  leverage_gt: ['3', '5', '10', '20'],
  size_gt: ['10000', '50000', '100000'],
  funding_gt: ['0.01', '0.05', '0.1'],
  rsi_lt: ['30'],
}

interface SimpleRuleBuilderProps {
  onSave: (rule: Record<string, unknown>) => void
}

export function SimpleRuleBuilder({ onSave }: SimpleRuleBuilderProps) {
  const [ifCond, setIfCond] = useState('')
  const [ifValue, setIfValue] = useState('')
  const [andCond, setAndCond] = useState('')
  const [andValue, setAndValue] = useState('')
  const [thenAction, setThenAction] = useState('')
  const [backtestData, setBacktestData] = useState<{
    strategyName: string
    data: Array<{ date: string; pnl: number }>
    totalPnl: number
    winRate: number
    tradeCount: number
    sharpe: number
    maxDrawdown: number
    signals: BacktestSignal[]
  } | null>(null)
  const [backtesting, setBacktesting] = useState(false)
  const [backtestError, setBacktestError] = useState('')

  const canSave = ifCond && thenAction

  // A rule is sandbox-testable only when it reduces to a price-indicator
  // strategy the real engine implements, on a concrete coin.
  const sandboxStrategy: { strategy: 'momentum' | 'mean_reversion'; coin: string } | null = (() => {
    if (ifCond !== 'asset_eq' || !ifValue) return null
    if (andCond === 'rsi_lt' && andValue === '30') {
      return { strategy: 'mean_reversion', coin: ifValue }
    }
    if (andCond === 'ema_trend') {
      return { strategy: 'momentum', coin: ifValue }
    }
    return null
  })()

  const runSandboxBacktest = async () => {
    if (!sandboxStrategy) return
    setBacktesting(true)
    setBacktestError('')
    setBacktestData(null)
    try {
      const endTime = Date.now()
      const startTime = endTime - 90 * 86400000
      const res = await fetch('/api/quant/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coin: sandboxStrategy.coin, startTime, endTime, interval: '1h' }),
      })
      if (!res.ok) throw new Error('Failed to fetch candle data')
      const { candles, count } = await res.json()
      if (!candles || count === 0) throw new Error(`No candle data for ${sandboxStrategy.coin}`)

      const config: BacktestConfig = {
        strategy: sandboxStrategy.strategy,
        positionSizeUsd: 10000,
        takerFeePct: 0.035,
      }
      const result = runBacktest(candles as Candle[], config)

      const label = sandboxStrategy.strategy === 'momentum'
        ? `EMA(20) Momentum — ${sandboxStrategy.coin}`
        : `RSI(14) Mean Reversion — ${sandboxStrategy.coin}`

      setBacktestData({
        strategyName: label,
        data: result.equityCurve,
        totalPnl: result.totalPnl,
        winRate: result.winRate,
        tradeCount: result.tradeCount,
        sharpe: result.sharpe,
        maxDrawdown: result.maxDrawdown,
        signals: result.trades.map(t => ({
          date: new Date(t.entryTime).toISOString().split('T')[0],
          asset: sandboxStrategy.coin,
          direction: t.side,
          entry: Math.round(t.entryPrice * 100) / 100,
          exit: Math.round(t.exitPrice * 100) / 100,
          pnl: t.pnl,
        })),
      })
    } catch (err) {
      setBacktestError(err instanceof Error ? err.message : 'Backtest failed')
    } finally {
      setBacktesting(false)
    }
  }

  const handleSave = () => {
    onSave({
      name: `Custom: ${IF_OPTIONS.find(o => o.value === ifCond)?.label || 'Rule'}`,
      walletConds: { if: ifCond, ifValue },
      marketConds: { and: andCond, andValue },
      action: thenAction,
    })
  }

  return (
    <div className="space-y-6">
      {/* IF row */}
      <div>
        <p className="text-xs font-mono text-[#34EAB9] mb-2">IF</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <select
            value={ifCond}
            onChange={e => { setIfCond(e.target.value); setIfValue('') }}
            className="w-full bg-[#0F1A1E] border border-white/[0.08] rounded px-3 py-2.5 text-sm outline-none focus:border-[#34EAB9]"
          >
            {IF_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {ifCond && VALUE_SUGGESTIONS[ifCond] ? (
            <select
              value={ifValue}
              onChange={e => setIfValue(e.target.value)}
              className="w-full bg-[#0F1A1E] border border-white/[0.08] rounded px-3 py-2.5 text-sm outline-none focus:border-[#34EAB9]"
            >
              <option value="">Select value...</option>
              {VALUE_SUGGESTIONS[ifCond].map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          ) : ifCond ? (
            <input
              value={ifValue}
              onChange={e => setIfValue(e.target.value)}
              placeholder="Value"
              className="w-full bg-[#0F1A1E] border border-white/[0.08] rounded px-3 py-2.5 text-sm outline-none focus:border-[#34EAB9]"
            />
          ) : null}
        </div>
      </div>

      {/* AND row */}
      <div>
        <p className="text-xs font-mono text-[#34EAB9] mb-2">AND</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <select
            value={andCond}
            onChange={e => { setAndCond(e.target.value); setAndValue('') }}
            className="w-full bg-[#0F1A1E] border border-white/[0.08] rounded px-3 py-2.5 text-sm outline-none focus:border-[#34EAB9]"
          >
            {AND_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {andCond && VALUE_SUGGESTIONS[andCond] ? (
            <select
              value={andValue}
              onChange={e => setAndValue(e.target.value)}
              className="w-full bg-[#0F1A1E] border border-white/[0.08] rounded px-3 py-2.5 text-sm outline-none focus:border-[#34EAB9]"
            >
              <option value="">Select value...</option>
              {VALUE_SUGGESTIONS[andCond].map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          ) : andCond && andCond !== 'ema_trend' ? (
            <input
              value={andValue}
              onChange={e => setAndValue(e.target.value)}
              placeholder="Value"
              className="w-full bg-[#0F1A1E] border border-white/[0.08] rounded px-3 py-2.5 text-sm outline-none focus:border-[#34EAB9]"
            />
          ) : null}
        </div>
      </div>

      {/* THEN row */}
      <div>
        <p className="text-xs font-mono text-[#34EAB9] mb-2">THEN</p>
        <select
          value={thenAction}
          onChange={e => setThenAction(e.target.value)}
          className="w-full bg-[#0F1A1E] border border-white/[0.08] rounded px-3 py-2.5 text-sm outline-none focus:border-[#34EAB9]"
        >
          {THEN_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={!canSave}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded text-sm font-semibold bg-[#34EAB9] text-[#0F1A1E] disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          <Save size={14} />
          Save Strategy
        </button>
        <button
          onClick={runSandboxBacktest}
          disabled={!sandboxStrategy || backtesting}
          title={sandboxStrategy ? undefined : 'Not yet testable in sandbox'}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded text-sm font-medium bg-[#0F1A1E] border border-white/[0.12] hover:border-[#34EAB9] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Play size={14} />
          {backtesting ? 'Running...' : 'Backtest This'}
        </button>
      </div>

      {!sandboxStrategy && ifCond && (
        <p className="text-[11px] text-white/40 text-center">
          Not yet testable in sandbox. The client engine evaluates
          price-indicator rules on a concrete asset (Asset = X with RSI(14) &lt; 30
          or price above EMA(20)). Wallet-event rules need the server-side
          verification engine.
        </p>
      )}

      {backtestError && (
        <p className="text-[11px] text-[#FF3B5C] text-center">{backtestError}</p>
      )}

      {backtestData && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <BacktestResult {...backtestData} />
        </motion.div>
      )}
    </div>
  )
}
