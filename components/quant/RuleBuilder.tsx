'use client'
import { useState } from 'react'
import { motion } from 'framer-motion'

const WALLET_CONDITIONS = [
  { id: 'archetype', label: 'Trader Type is', type: 'select' as const, options: ['Any', 'Scalper', 'Swing Trader', 'Momentum', 'High Conviction', 'Funding Arb'] },
  { id: 'min_sharpe', label: 'Sharpe (30d) above', type: 'number' as const, placeholder: '1.0' },
  { id: 'max_decay', label: 'Alpha Decay below', type: 'number' as const, placeholder: '0.2' },
  { id: 'min_win_rate', label: 'Win Rate above', type: 'number' as const, placeholder: '0.55' },
  { id: 'min_pnl', label: 'Total PnL above ($USD)', type: 'number' as const, placeholder: '10000' },
]

const MARKET_CONDITIONS = [
  { id: 'asset', label: 'Asset is', type: 'select' as const, options: ['Any', 'BTC', 'ETH', 'SOL', 'ARB', 'OP', 'AVAX', 'DOGE', 'WIF'] },
  { id: 'side', label: 'Direction is', type: 'select' as const, options: ['Any', 'Long', 'Short'] },
  { id: 'min_size', label: 'Position size above ($USD)', type: 'number' as const, placeholder: '5000' },
  { id: 'rsi_below', label: 'RSI below', type: 'number' as const, placeholder: '45' },
  { id: 'rsi_above', label: 'RSI above', type: 'number' as const, placeholder: '55' },
  { id: 'funding_positive', label: 'Funding rate', type: 'select' as const, options: ['Any', 'Positive', 'Negative'] },
]

type ConditionDef = { id: string; label: string; type: 'select' | 'number'; options?: string[]; placeholder?: string }

export function RuleBuilder({ onSave }: { onSave: (rule: Record<string, unknown>) => void }) {
  const [walletConds, setWalletConds] = useState<Record<string, string>>({})
  const [marketConds, setMarketConds] = useState<Record<string, string>>({})
  const [name, setName] = useState('')
  const [activeWallet, setActiveWallet] = useState<string[]>([])
  const [activeMarket, setActiveMarket] = useState<string[]>([])

  const toggleCondition = (id: string, group: 'wallet' | 'market') => {
    if (group === 'wallet') {
      setActiveWallet(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
    } else {
      setActiveMarket(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="text-sm text-[#888888] block mb-2">Rule Name</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="My strategy rule..."
          className="w-full bg-[#161616] border border-[#222222] rounded-xl px-4 py-3 text-sm outline-none focus:border-[#00ff88] transition-colors"
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

      <div className="card p-4 border-[#00ff88]/30">
        <p className="text-xs text-[#888888] mb-1">THEN</p>
        <p className="font-medium text-sm text-[#00ff88]">Send me an alert and log to paper portfolio</p>
      </div>

      <button
        onClick={() => onSave({ name, walletConds, marketConds, activeWallet, activeMarket })}
        disabled={!name}
        className="w-full py-4 rounded-2xl font-semibold bg-[#00ff88] text-black disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
      >
        Save Rule
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
      <p className="text-xs text-[#888888] uppercase tracking-wider mb-3">{title}</p>
      <div className="space-y-2">
        {conditions.map((cond) => {
          const isActive = active.includes(cond.id)
          return (
            <motion.div
              key={cond.id}
              layout
              className={`card p-3 cursor-pointer transition-all ${isActive ? 'border-[#00ff88]/40' : 'hover:border-[#333333]'}`}
              onClick={() => onToggle(cond.id)}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm">{cond.label}</span>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${isActive ? 'border-[#00ff88] bg-[#00ff88]' : 'border-[#444]'}`}>
                  {isActive && <span className="text-black text-xs font-bold">&#10003;</span>}
                </div>
              </div>
              {isActive && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-2" onClick={e => e.stopPropagation()}>
                  {cond.type === 'select' && cond.options ? (
                    <select
                      className="w-full bg-[#0a0a0a] border border-[#333] rounded-lg px-3 py-2 text-sm outline-none"
                      value={values[cond.id] || ''}
                      onChange={e => onChange(cond.id, e.target.value)}
                    >
                      {cond.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      type="number"
                      placeholder={cond.placeholder}
                      value={values[cond.id] || ''}
                      onChange={e => onChange(cond.id, e.target.value)}
                      className="w-full bg-[#0a0a0a] border border-[#333] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00ff88]"
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
