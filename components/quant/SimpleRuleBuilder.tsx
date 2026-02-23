'use client'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Play, Save } from 'lucide-react'
import { BacktestResult, type BacktestSignal } from './BacktestResult'

const IF_OPTIONS = [
  { value: '', label: 'Select condition...' },
  { value: 'whale_opens', label: 'Whale opens position' },
  { value: 'wallets_converge', label: '3+ wallets converge' },
  { value: 'archetype_eq', label: 'Wallet archetype =' },
  { value: 'asset_eq', label: 'Asset =' },
  { value: 'confidence_gt', label: 'Confidence score >' },
]

const AND_OPTIONS = [
  { value: '', label: 'Select condition...' },
  { value: 'direction_eq', label: 'Direction =' },
  { value: 'leverage_gt', label: 'Leverage >' },
  { value: 'size_gt', label: 'Size >' },
  { value: 'funding_gt', label: 'Funding rate >' },
  { value: 'rsi_lt', label: 'RSI <' },
]

const THEN_OPTIONS = [
  { value: '', label: 'Select action...' },
  { value: 'alert', label: 'Send alert' },
  { value: 'mirror', label: 'Mirror trade' },
  { value: 'watchlist', label: 'Log to watchlist' },
]

const VALUE_SUGGESTIONS: Record<string, string[]> = {
  archetype_eq: ['Scalper', 'Momentum', 'Swing Trader', 'High Conviction', 'Farmer', 'Funding Arb'],
  asset_eq: ['BTC', 'ETH', 'SOL', 'HYPE', 'ARB', 'DOGE'],
  direction_eq: ['Long', 'Short'],
  confidence_gt: ['5', '7', '8'],
  leverage_gt: ['3', '5', '10', '20'],
  size_gt: ['10000', '50000', '100000'],
  funding_gt: ['0.01', '0.05', '0.1'],
  rsi_lt: ['30', '40', '45'],
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

  const canSave = ifCond && thenAction
  const canBacktest = ifCond

  const runBacktest = () => {
    setBacktesting(true)
    setTimeout(() => {
      const days = 90
      let cumPnl = 0
      let peak = 0
      let maxDd = 0
      const data = Array.from({ length: days }, (_, i) => {
        const change = (Math.random() - 0.38) * 400
        cumPnl += change
        if (cumPnl > peak) peak = cumPnl
        const dd = peak - cumPnl
        if (dd > maxDd) maxDd = dd
        return {
          date: new Date(Date.now() - (days - i) * 86400000).toISOString().split('T')[0],
          pnl: Math.round(cumPnl),
        }
      })
      const dailyReturns = data.map((d, i) => (i === 0 ? 0 : d.pnl - data[i - 1].pnl))
      const mean = dailyReturns.reduce((s, v) => s + v, 0) / dailyReturns.length
      const std = Math.sqrt(dailyReturns.reduce((s, v) => s + (v - mean) ** 2, 0) / dailyReturns.length) || 1

      const ifLabel = IF_OPTIONS.find(o => o.value === ifCond)?.label || 'Custom'
      const assets = ['ETH', 'BTC', 'SOL', 'HYPE', 'ARB']
      const mockSignals: BacktestSignal[] = Array.from({ length: 5 }, (_, i) => {
        const asset = assets[i % assets.length]
        const dir: 'Long' | 'Short' = Math.random() > 0.4 ? 'Long' : 'Short'
        const entry = asset === 'BTC' ? 62000 + Math.round(Math.random() * 5000) : asset === 'ETH' ? 3200 + Math.round(Math.random() * 400) : 100 + Math.round(Math.random() * 50)
        const pnlAmt = Math.round((Math.random() - 0.35) * 2000)
        return {
          date: new Date(Date.now() - (i * 8 + Math.floor(Math.random() * 5)) * 86400000).toISOString().split('T')[0],
          asset,
          direction: dir,
          entry,
          exit: Math.round((entry + entry * (pnlAmt / 50000)) * 100) / 100,
          pnl: pnlAmt,
        }
      })

      setBacktestData({
        strategyName: ifLabel,
        data,
        totalPnl: Math.round(cumPnl),
        winRate: 0.5 + Math.random() * 0.18,
        tradeCount: Math.floor(15 + Math.random() * 50),
        sharpe: Math.round((mean / std) * Math.sqrt(365) * 100) / 100,
        maxDrawdown: Math.round(maxDd),
        signals: mockSignals,
      })
      setBacktesting(false)
    }, 800)
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
          ) : andCond ? (
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
          onClick={runBacktest}
          disabled={!canBacktest || backtesting}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded text-sm font-medium bg-[#0F1A1E] border border-white/[0.12] hover:border-[#34EAB9] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Play size={14} />
          {backtesting ? 'Running...' : 'Backtest This'}
        </button>
      </div>

      <p className="text-xs text-white/40 text-center">
        Start simple. Add one rule, backtest it, then layer in conditions.
      </p>

      {backtestData && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <BacktestResult {...backtestData} />
        </motion.div>
      )}
    </div>
  )
}
