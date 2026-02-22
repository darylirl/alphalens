'use client'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { SlidersHorizontal, X } from 'lucide-react'

const ARCHETYPES = [
  { value: 'all', label: 'All Types' },
  { value: 'scalper', label: 'Scalper' },
  { value: 'swing_trader', label: 'Swing' },
  { value: 'momentum_trader', label: 'Momentum' },
  { value: 'high_conviction', label: 'High Conv.' },
  { value: 'funding_arb', label: 'Funding Arb' },
]

const SORT_OPTIONS = [
  { value: 'sharpe_30d', label: 'Sharpe (30d)' },
  { value: 'total_pnl_usd', label: 'Total PnL' },
  { value: 'win_rate', label: 'Win Rate' },
  { value: 'alpha_decay_score', label: 'Alpha Decay' },
  { value: 'trade_count_30d', label: 'Trade Count' },
]

interface FilterPanelProps {
  archetype: string
  sort: string
  onArchetypeChange: (val: string) => void
  onSortChange: (val: string) => void
}

export function FilterPanel({ archetype, sort, onArchetypeChange, onSortChange }: FilterPanelProps) {
  const [expanded, setExpanded] = useState(false)

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
          {expanded ? 'Close' : 'Sort'}
        </button>
      </div>

      {expanded && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="flex gap-2 flex-wrap"
        >
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
        </motion.div>
      )}
    </div>
  )
}
