'use client'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Play, AlertCircle, Zap } from 'lucide-react'
import { BacktestResult } from './BacktestResult'

const WALLET_CONDITIONS = [
  { id: 'specific_wallet', label: 'Specific Wallet Address', type: 'text' as const, placeholder: '0x...' },
  { id: 'archetype', label: 'Trader Type is', type: 'select' as const, options: ['Any', 'Scalper', 'Swing Trader', 'Momentum', 'High Conviction', 'Funding Arb', 'Market Maker', 'Farmer'] },
  { id: 'min_sharpe', label: 'Sharpe (30d) above', type: 'number' as const, placeholder: '1.0' },
  { id: 'max_decay', label: 'Alpha Decay below', type: 'number' as const, placeholder: '0.2' },
  { id: 'min_win_rate', label: 'Win Rate above', type: 'number' as const, placeholder: '0.55' },
  { id: 'min_pnl', label: 'Total PnL above ($USD)', type: 'number' as const, placeholder: '10000' },
  { id: 'min_account', label: 'Account Value above ($USD)', type: 'number' as const, placeholder: '50000' },
]

const MARKET_CONDITIONS = [
  { id: 'asset', label: 'Asset is', type: 'select' as const, options: ['Any', 'BTC', 'ETH', 'SOL', 'ARB', 'OP', 'AVAX', 'DOGE', 'WIF', 'HYPE', 'RENDER', 'FET'] },
  { id: 'side', label: 'Direction is', type: 'select' as const, options: ['Any', 'Long', 'Short'] },
  { id: 'min_size', label: 'Position size above ($USD)', type: 'number' as const, placeholder: '5000' },
  { id: 'min_leverage', label: 'Leverage above', type: 'number' as const, placeholder: '3' },
  { id: 'max_leverage', label: 'Leverage below', type: 'number' as const, placeholder: '20' },
  { id: 'rsi_below', label: 'RSI below', type: 'number' as const, placeholder: '45' },
  { id: 'rsi_above', label: 'RSI above', type: 'number' as const, placeholder: '55' },
  { id: 'funding_positive', label: 'Funding rate', type: 'select' as const, options: ['Any', 'Positive', 'Negative', 'Extreme (>0.05%)'] },
]

const CONTEXT_ENRICHMENTS = [
  { id: 'show_funding', label: 'Show current funding rate' },
  { id: 'show_liquidations', label: 'Show recent liquidations' },
  { id: 'show_correlated', label: 'Show correlated wallet positions (4h)' },
  { id: 'show_oi', label: 'Show open interest change' },
  { id: 'show_volume', label: 'Show 24h volume profile' },
]

const ACTION_OPTIONS = [
  { id: 'alert_only', label: 'Send me an alert', desc: 'Notification with full context', default: true },
  { id: 'paper_trade', label: 'Log to paper portfolio', desc: 'Track hypothetical performance' },
  { id: 'pre_fill_trade', label: 'Pre-fill trade on Hyperliquid', desc: 'One-tap execution card' },
  { id: 'copy_trade', label: 'Auto-mirror position', desc: 'Copy trade at your configured ratio' },
]

type ConditionDef = { id: string; label: string; type: 'select' | 'number' | 'text'; options?: string[]; placeholder?: string }

export function RuleBuilder({ onSave }: { onSave: (rule: Record<string, unknown>) => void }) {
  const [walletConds, setWalletConds] = useState<Record<string, string>>({})
  const [marketConds, setMarketConds] = useState<Record<string, string>>({})
  const [name, setName] = useState('')
  const [activeWallet, setActiveWallet] = useState<string[]>([])
  const [activeMarket, setActiveMarket] = useState<string[]>([])
  const [selectedEnrichments, setSelectedEnrichments] = useState<string[]>(['show_funding', 'show_correlated'])
  const [selectedActions, setSelectedActions] = useState<string[]>(['alert_only', 'paper_trade'])
  const [backtestData, setBacktestData] = useState<{ data: Array<{ date: string; pnl: number }>; totalPnl: number; winRate: number; tradeCount: number; sharpe: number } | null>(null)
  const [backtesting, setBacktesting] = useState(false)

  const toggleCondition = (id: string, group: 'wallet' | 'market') => {
    if (group === 'wallet') {
      setActiveWallet(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
    } else {
      setActiveMarket(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
    }
  }

  const toggleEnrichment = (id: string) => {
    setSelectedEnrichments(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const toggleAction = (id: string) => {
    setSelectedActions(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const hasConditions = activeWallet.length > 0 || activeMarket.length > 0

  const runBacktest = () => {
    setBacktesting(true)
    setTimeout(() => {
      const strictness = (activeWallet.length + activeMarket.length) / 6
      const days = 30
      let cumPnl = 0
      const tradeCount = Math.floor(15 + Math.random() * 80 * (1 - strictness * 0.5))
      const winRate = 0.48 + Math.random() * 0.2 + strictness * 0.05
      const data = Array.from({ length: days }, (_, i) => {
        const change = (Math.random() - (0.42 - strictness * 0.08)) * (300 + strictness * 200)
        cumPnl += change
        return {
          date: new Date(Date.now() - (days - i) * 86400000).toISOString().split('T')[0],
          pnl: Math.round(cumPnl)
        }
      })
      const dailyReturns = data.map((d, i) => i === 0 ? 0 : d.pnl - data[i - 1].pnl)
      const mean = dailyReturns.reduce((s, v) => s + v, 0) / dailyReturns.length
      const std = Math.sqrt(dailyReturns.reduce((s, v) => s + (v - mean) ** 2, 0) / dailyReturns.length) || 1
      const sharpe = Math.round((mean / std) * Math.sqrt(365) * 100) / 100

      setBacktestData({
        data,
        totalPnl: Math.round(cumPnl),
        winRate: Math.round(winRate * 100) / 100,
        tradeCount,
        sharpe
      })
      setBacktesting(false)
    }, 800)
  }

  // Build readable rule summary
  const ruleSummary = () => {
    const parts: string[] = []
    if (walletConds.specific_wallet) parts.push(`wallet ${walletConds.specific_wallet.slice(0, 8)}...`)
    if (walletConds.archetype && walletConds.archetype !== 'Any') parts.push(`${walletConds.archetype} trader`)
    if (marketConds.asset && marketConds.asset !== 'Any') parts.push(`on ${marketConds.asset}`)
    if (marketConds.side && marketConds.side !== 'Any') parts.push(`opens ${marketConds.side}`)
    if (marketConds.min_size) parts.push(`size >${marketConds.min_size}`)
    return parts.length > 0 ? `When ${parts.join(', ')}` : ''
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="text-sm text-white/55 block mb-2">Rule Name</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g., Alert on whale ETH longs above $50K"
          className="w-full bg-[#0F1A1E] border border-white/[0.08] rounded px-4 py-3 text-sm outline-none focus:border-[#34EAB9] transition-colors"
        />
      </div>

      <ConditionSection
        title="IF Wallet..."
        conditions={WALLET_CONDITIONS}
        active={activeWallet}
        values={walletConds}
        onToggle={id => toggleCondition(id, 'wallet')}
        onChange={(id, val) => setWalletConds(prev => ({ ...prev, [id]: val }))}
      />

      <ConditionSection
        title="AND Market..."
        conditions={MARKET_CONDITIONS}
        active={activeMarket}
        values={marketConds}
        onToggle={id => toggleCondition(id, 'market')}
        onChange={(id, val) => setMarketConds(prev => ({ ...prev, [id]: val }))}
      />

      {/* Context enrichment */}
      <div>
        <p className="text-xs text-white/55 uppercase tracking-wider mb-3">INCLUDE IN ALERT</p>
        <div className="flex flex-wrap gap-2">
          {CONTEXT_ENRICHMENTS.map(e => (
            <button
              key={e.id}
              onClick={() => toggleEnrichment(e.id)}
              className={`text-[10px] px-2.5 py-1.5 rounded-full transition-colors ${
                selectedEnrichments.includes(e.id)
                  ? 'bg-[#34EAB9] text-[#0F1A1E] font-semibold'
                  : 'bg-[#0F1A1E] text-white/55 border border-white/[0.08]'
              }`}
            >
              {e.label}
            </button>
          ))}
        </div>
      </div>

      {/* Action options */}
      <div>
        <p className="text-xs text-white/55 uppercase tracking-wider mb-3">THEN</p>
        <div className="space-y-2">
          {ACTION_OPTIONS.map(a => (
            <button
              key={a.id}
              onClick={() => toggleAction(a.id)}
              className={`w-full text-left card p-3 transition-all ${
                selectedActions.includes(a.id) ? 'border-[#34EAB9]/40' : 'hover:border-white/[0.12]'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap size={12} className={selectedActions.includes(a.id) ? 'text-[#34EAB9]' : 'text-white/40'} />
                  <div>
                    <p className="text-sm font-medium">{a.label}</p>
                    <p className="text-[10px] text-white/40">{a.desc}</p>
                  </div>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                  selectedActions.includes(a.id) ? 'border-[#34EAB9] bg-[#34EAB9]' : 'border-white/40'
                }`}>
                  {selectedActions.includes(a.id) && <span className="text-[#0F1A1E] text-xs font-bold">&#10003;</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Rule preview */}
      {hasConditions && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="card p-4 border-l-2 border-l-[#34EAB9] bg-[#34EAB905]">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle size={14} className="text-[#34EAB9]" />
              <span className="text-xs text-white/40">Rule Preview</span>
            </div>
            <p className="text-sm text-[#F0FAF8]">
              {ruleSummary() || 'Your rule conditions will appear here'}
            </p>
            {selectedEnrichments.length > 0 && (
              <p className="text-[10px] text-white/40 mt-1">
                + {selectedEnrichments.map(id => CONTEXT_ENRICHMENTS.find(e => e.id === id)?.label).join(', ')}
              </p>
            )}
          </div>
        </motion.div>
      )}

      {hasConditions && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <button
            onClick={runBacktest}
            disabled={backtesting}
            className="w-full flex items-center justify-center gap-2 py-3 rounded text-sm font-medium bg-[#0F1A1E] border border-white/[0.12] hover:border-[#34EAB9] transition-colors disabled:opacity-50"
          >
            <Play size={14} />
            {backtesting ? 'Running Backtest...' : 'Run Backtest'}
          </button>
        </motion.div>
      )}

      {backtestData && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <h3 className="text-sm font-semibold mb-3">Backtest Results</h3>
          <BacktestResult {...backtestData} />
        </motion.div>
      )}

      <button
        onClick={() => onSave({
          name,
          walletConds,
          marketConds,
          activeWallet,
          activeMarket,
          enrichments: selectedEnrichments,
          actions: selectedActions,
        })}
        disabled={!name || !hasConditions || selectedActions.length === 0}
        className="w-full py-4 rounded-lg font-semibold bg-[#34EAB9] text-[#0F1A1E] disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
      >
        Activate Rule
      </button>
    </div>
  )
}

function ConditionSection({ title, conditions, active, values, onToggle, onChange }: {
  title: string
  conditions: ConditionDef[]
  active: string[]
  values: Record<string, string>
  onToggle: (id: string) => void
  onChange: (id: string, val: string) => void
}) {
  return (
    <div>
      <p className="text-xs text-white/55 uppercase tracking-wider mb-3">{title}</p>
      <div className="space-y-2">
        {conditions.map((cond) => {
          const isActive = active.includes(cond.id)
          return (
            <motion.div
              key={cond.id}
              layout
              className={`card p-3 cursor-pointer transition-all ${isActive ? 'border-[#34EAB9]/40' : 'hover:border-white/[0.12]'}`}
              onClick={() => onToggle(cond.id)}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm">{cond.label}</span>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${isActive ? 'border-[#34EAB9] bg-[#34EAB9]' : 'border-white/40'}`}>
                  {isActive && <span className="text-[#0F1A1E] text-xs font-bold">&#10003;</span>}
                </div>
              </div>
              {isActive && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-2" onClick={e => e.stopPropagation()}>
                  {cond.type === 'select' && cond.options ? (
                    <select
                      className="w-full bg-[#0F1A1E] border border-white/[0.12] rounded-lg px-3 py-2 text-sm outline-none"
                      value={values[cond.id] || ''}
                      onChange={e => onChange(cond.id, e.target.value)}
                    >
                      {cond.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : cond.type === 'text' ? (
                    <input
                      type="text"
                      placeholder={cond.placeholder}
                      value={values[cond.id] || ''}
                      onChange={e => onChange(cond.id, e.target.value)}
                      className="w-full bg-[#0F1A1E] border border-white/[0.12] rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-[#34EAB9]"
                    />
                  ) : (
                    <input
                      type="number"
                      placeholder={cond.placeholder}
                      value={values[cond.id] || ''}
                      onChange={e => onChange(cond.id, e.target.value)}
                      className="w-full bg-[#0F1A1E] border border-white/[0.12] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#34EAB9]"
                    />
                  )}
                </motion.div>
              )}
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
