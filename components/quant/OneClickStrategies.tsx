'use client'
import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { ChevronDown, Play, Zap } from 'lucide-react'

const TEMPLATES = [
  {
    id: 'whale_momentum',
    name: 'Whale Momentum',
    description: 'Alert when high-conviction wallets (Sharpe >1.5) open new longs and RSI is below 45',
    archetype: 'high_conviction',
    emoji: '\u{1F40B}',
    params: [
      { id: 'min_sharpe', label: 'Min Sharpe (30d)', value: '1.5', type: 'number' },
      { id: 'max_alpha_decay', label: 'Max Alpha Decay', value: '0.15', type: 'number' },
      { id: 'rsi_below', label: 'RSI Below', value: '45', type: 'number' },
      { id: 'side', label: 'Direction', value: 'Long', type: 'select', options: ['Long', 'Short', 'Both'] },
    ]
  },
  {
    id: 'scalper_reversal',
    name: 'Scalper Cluster',
    description: 'Trigger when 3+ scalper wallets flip from short to long within 5 minutes',
    archetype: 'scalper',
    emoji: '\u26A1',
    params: [
      { id: 'min_wallets', label: 'Min Wallets', value: '3', type: 'number' },
      { id: 'flip_window', label: 'Time Window (min)', value: '5', type: 'number' },
      { id: 'flip_dir', label: 'Flip Direction', value: 'Short to Long', type: 'select', options: ['Short to Long', 'Long to Short', 'Any'] },
      { id: 'asset', label: 'Asset', value: 'Any', type: 'select', options: ['Any', 'BTC', 'ETH', 'SOL', 'ARB', 'DOGE'] },
    ]
  },
  {
    id: 'funding_fade',
    name: 'Funding Fade',
    description: 'Alert when funding arb wallets open large shorts and funding rate exceeds 0.05%',
    archetype: 'funding_arb',
    emoji: '\u{1F4C9}',
    params: [
      { id: 'min_funding', label: 'Min Funding Rate (%)', value: '0.05', type: 'number' },
      { id: 'side', label: 'Direction', value: 'Short', type: 'select', options: ['Short', 'Long', 'Both'] },
      { id: 'min_size', label: 'Min Position ($)', value: '10000', type: 'number' },
      { id: 'asset', label: 'Asset', value: 'Any', type: 'select', options: ['Any', 'BTC', 'ETH', 'SOL'] },
    ]
  },
  {
    id: 'momentum_breakout',
    name: 'Momentum Breakout',
    description: 'Follow momentum traders entering positions when price breaks 24h high',
    archetype: 'momentum_trader',
    emoji: '\u{1F680}',
    params: [
      { id: 'min_wallets', label: 'Min Wallets', value: '2', type: 'number' },
      { id: 'breakout', label: 'Breakout Type', value: '24h High', type: 'select', options: ['24h High', '24h Low', 'Either'] },
      { id: 'min_leverage', label: 'Min Leverage', value: '3', type: 'number' },
      { id: 'asset', label: 'Asset', value: 'Any', type: 'select', options: ['Any', 'BTC', 'ETH', 'SOL', 'ARB', 'DOGE', 'WIF'] },
    ]
  },
]

interface OneClickStrategiesProps {
  onSelect: (template: Record<string, unknown>) => void
  onActivate: (template: Record<string, unknown>) => void
}

export function OneClickStrategies({ onSelect, onActivate }: OneClickStrategiesProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [paramValues, setParamValues] = useState<Record<string, Record<string, string>>>({})
  const [backtesting, setBacktesting] = useState<string | null>(null)

  const getParamValue = (templateId: string, paramId: string, defaultVal: string) => {
    return paramValues[templateId]?.[paramId] ?? defaultVal
  }

  const setParamValue = (templateId: string, paramId: string, val: string) => {
    setParamValues(prev => ({
      ...prev,
      [templateId]: { ...prev[templateId], [paramId]: val }
    }))
  }

  const handleBacktest = async (template: typeof TEMPLATES[number]) => {
    setBacktesting(template.id)
    const params = template.params.reduce((acc, p) => ({
      ...acc,
      [p.id]: getParamValue(template.id, p.id, p.value)
    }), {})
    onSelect({ ...template, conditions: params })
    setTimeout(() => setBacktesting(null), 500)
  }

  const handleActivate = (template: typeof TEMPLATES[number]) => {
    const params = template.params.reduce((acc, p) => ({
      ...acc,
      [p.id]: getParamValue(template.id, p.id, p.value)
    }), {})
    onActivate({ name: template.name, archetype: template.archetype, conditions: params })
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-[#8AADA9]">Select a strategy, customize parameters, backtest, then activate</p>
      {TEMPLATES.map((t, i) => {
        const isExpanded = expandedId === t.id
        return (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.08 }}
            className={`card transition-all ${isExpanded ? 'border-[#34EAB9]/40' : 'hover:border-[#0F3D38]'}`}
          >
            <button
              onClick={() => setExpandedId(isExpanded ? null : t.id)}
              className="w-full text-left p-4"
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl">{t.emoji}</span>
                <div className="flex-1">
                  <p className="font-semibold text-sm mb-1">{t.name}</p>
                  <p className="text-[#8AADA9] text-xs leading-relaxed">{t.description}</p>
                </div>
                <ChevronDown size={16} className={`text-[#8AADA9] transition-transform mt-1 ${isExpanded ? 'rotate-180' : ''}`} />
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
                  <div className="px-4 pb-4 space-y-3">
                    <div className="border-t border-[#0D2E2A] pt-3" />
                    <p className="text-xs text-[#8AADA9] uppercase tracking-wider">Parameters</p>
                    <div className="grid grid-cols-2 gap-2">
                      {t.params.map(p => (
                        <div key={p.id}>
                          <label className="text-xs text-[#4A706C] block mb-1">{p.label}</label>
                          {p.type === 'select' && p.options ? (
                            <select
                              className="w-full bg-[#010E0C] border border-[#0F3D38] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#34EAB9]"
                              value={getParamValue(t.id, p.id, p.value)}
                              onChange={e => setParamValue(t.id, p.id, e.target.value)}
                            >
                              {p.options.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          ) : (
                            <input
                              type="number"
                              step="any"
                              className="w-full bg-[#010E0C] border border-[#0F3D38] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#34EAB9]"
                              value={getParamValue(t.id, p.id, p.value)}
                              onChange={e => setParamValue(t.id, p.id, e.target.value)}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => handleBacktest(t)}
                        disabled={backtesting === t.id}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded text-sm font-medium bg-[#072724] border border-[#0F3D38] hover:border-[#34EAB9] transition-colors disabled:opacity-50"
                      >
                        <Play size={14} />
                        {backtesting === t.id ? 'Running...' : 'Backtest'}
                      </button>
                      <button
                        onClick={() => handleActivate(t)}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded text-sm font-semibold bg-[#34EAB9] text-[#010E0C]"
                      >
                        <Zap size={14} />
                        Activate
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )
      })}
    </div>
  )
}
