'use client'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { SlidersHorizontal, X, ChevronDown } from 'lucide-react'

const ARCHETYPES = [
  { value: 'all', label: 'All Types' },
  { value: 'scalper', label: 'Scalper' },
  { value: 'swing_trader', label: 'Swing' },
  { value: 'momentum_trader', label: 'Momentum' },
  { value: 'high_conviction', label: 'High Conv.' },
  { value: 'funding_arb', label: 'Funding Arb' },
  { value: 'farmer', label: 'Farmer' },
  { value: 'market_maker', label: 'Market Maker' },
]

const SORT_OPTIONS = [
  { value: 'sharpe_30d', label: 'Sharpe (30d)' },
  { value: 'total_pnl_usd', label: 'Total PnL' },
  { value: 'win_rate', label: 'Win Rate' },
  { value: 'alpha_decay_score', label: 'Alpha Decay' },
  { value: 'trade_count_30d', label: 'Trade Count' },
  { value: 'avg_leverage', label: 'Avg Leverage' },
]

const TIME_WINDOWS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
]

export interface AdvancedFilters {
  minTrades: string
  minWinRate: string
  minPnl: string
  maxLeverage: string
  timeWindow: string
}

interface FilterPanelProps {
  archetype: string
  sort: string
  onArchetypeChange: (val: string) => void
  onSortChange: (val: string) => void
  advancedFilters?: AdvancedFilters
  onAdvancedFiltersChange?: (filters: AdvancedFilters) => void
}

export function FilterPanel({ archetype, sort, onArchetypeChange, onSortChange, advancedFilters, onAdvancedFiltersChange }: FilterPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const filters = advancedFilters || { minTrades: '', minWinRate: '', minPnl: '', maxLeverage: '', timeWindow: '30' }

  const updateFilter = (key: keyof AdvancedFilters, value: string) => {
    onAdvancedFiltersChange?.({ ...filters, [key]: value })
  }

  const activeFilterCount = [filters.minTrades, filters.minWinRate, filters.minPnl, filters.maxLeverage].filter(Boolean).length

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
        {ARCHETYPES.map(a => (
          <button
            key={a.value}
            onClick={() => onArchetypeChange(a.value)}
            className={`whitespace-nowrap text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
              archetype === a.value
                ? 'bg-[#00ff88] text-black'
                : 'bg-[#161616] text-[#888888] hover:text-white'
            }`}
          >
            {a.label}
          </button>
        ))}

        <button
          onClick={() => setExpanded(!expanded)}
          className={`ml-auto flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full transition-colors ${
            expanded ? 'bg-[#00ff8820] text-[#00ff88]' : 'bg-[#161616] text-[#888888]'
          }`}
        >
          {expanded ? <X size={12} /> : <SlidersHorizontal size={12} />}
          {expanded ? 'Close' : 'Filters'}
          {activeFilterCount > 0 && !expanded && (
            <span className="bg-[#00ff88] text-black text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {expanded && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="space-y-3"
        >
          {/* Sort options */}
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[#666666] mb-2">Sort By</p>
            <div className="flex gap-2 flex-wrap">
              {SORT_OPTIONS.map(s => (
                <button
                  key={s.value}
                  onClick={() => onSortChange(s.value)}
                  className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                    sort === s.value
                      ? 'bg-[#00ff8820] text-[#00ff88] border border-[#00ff8840]'
                      : 'bg-[#161616] text-[#888888] border border-transparent hover:text-white'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Advanced filters toggle */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs text-[#888888] hover:text-white transition-colors"
          >
            <ChevronDown size={12} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
            Advanced Filters
          </button>

          {showAdvanced && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="card p-3 space-y-3"
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-[#666666] mb-1 block">Time Window</label>
                  <select
                    value={filters.timeWindow}
                    onChange={e => updateFilter('timeWindow', e.target.value)}
                    className="w-full bg-[#111111] border border-[#222222] rounded-lg px-2.5 py-2 text-xs outline-none focus:border-[#00ff88]"
                  >
                    {TIME_WINDOWS.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-[#666666] mb-1 block">Min Trades</label>
                  <input
                    type="number"
                    value={filters.minTrades}
                    onChange={e => updateFilter('minTrades', e.target.value)}
                    placeholder="e.g. 10"
                    className="w-full bg-[#111111] border border-[#222222] rounded-lg px-2.5 py-2 text-xs outline-none focus:border-[#00ff88] placeholder:text-[#444444]"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-[#666666] mb-1 block">Min Win Rate (%)</label>
                  <input
                    type="number"
                    value={filters.minWinRate}
                    onChange={e => updateFilter('minWinRate', e.target.value)}
                    placeholder="e.g. 50"
                    className="w-full bg-[#111111] border border-[#222222] rounded-lg px-2.5 py-2 text-xs outline-none focus:border-[#00ff88] placeholder:text-[#444444]"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-[#666666] mb-1 block">Min PnL (USD)</label>
                  <input
                    type="number"
                    value={filters.minPnl}
                    onChange={e => updateFilter('minPnl', e.target.value)}
                    placeholder="e.g. 1000"
                    className="w-full bg-[#111111] border border-[#222222] rounded-lg px-2.5 py-2 text-xs outline-none focus:border-[#00ff88] placeholder:text-[#444444]"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-[#666666] mb-1 block">Max Leverage</label>
                  <input
                    type="number"
                    value={filters.maxLeverage}
                    onChange={e => updateFilter('maxLeverage', e.target.value)}
                    placeholder="e.g. 20"
                    className="w-full bg-[#111111] border border-[#222222] rounded-lg px-2.5 py-2 text-xs outline-none focus:border-[#00ff88] placeholder:text-[#444444]"
                  />
                </div>
              </div>
              {activeFilterCount > 0 && (
                <button
                  onClick={() => onAdvancedFiltersChange?.({ minTrades: '', minWinRate: '', minPnl: '', maxLeverage: '', timeWindow: '30' })}
                  className="text-xs text-[#ff3b3b] hover:underline"
                >
                  Clear all filters
                </button>
              )}
            </motion.div>
          )}
        </motion.div>
      )}
    </div>
  )
}
