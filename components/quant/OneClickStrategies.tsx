'use client'
import { motion } from 'framer-motion'
import { useState } from 'react'

const TEMPLATES = [
  {
    id: 'whale_momentum',
    name: 'Whale Momentum',
    description: 'Alert when high-conviction wallets (Sharpe >1.5) open new longs and RSI is below 45',
    archetype: 'high_conviction',
    conditions: { min_sharpe: 1.5, max_alpha_decay: 0.15, rsi_below: 45, sides: ['long'] },
    emoji: '\u{1F40B}'
  },
  {
    id: 'scalper_reversal',
    name: 'Scalper Cluster',
    description: 'Trigger when 3+ scalper wallets flip from short to long within 5 minutes',
    archetype: 'scalper',
    conditions: { min_wallets: 3, flip_window_minutes: 5, flip_direction: 'short_to_long' },
    emoji: '\u26A1'
  },
  {
    id: 'funding_fade',
    name: 'Funding Fade',
    description: 'Alert when funding arb wallets open large shorts and funding rate exceeds 0.05%',
    archetype: 'funding_arb',
    conditions: { side: 'short', min_funding_rate: 0.0005 },
    emoji: '\u{1F4C9}'
  },
  {
    id: 'momentum_breakout',
    name: 'Momentum Breakout',
    description: 'Follow momentum traders entering positions when price breaks 24h high',
    archetype: 'momentum_trader',
    conditions: { price_above_24h_high: true, min_wallets: 2 },
    emoji: '\u{1F680}'
  },
]

interface OneClickStrategiesProps {
  onSelect: (template: typeof TEMPLATES[number]) => void
}

export function OneClickStrategies({ onSelect }: OneClickStrategiesProps) {
  const [selected, setSelected] = useState<string | null>(null)

  return (
    <div className="space-y-3">
      <p className="text-sm text-[#888888]">Start with a pre-built strategy and customize it</p>
      {TEMPLATES.map((t, i) => (
        <motion.button
          key={t.id}
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.08 }}
          onClick={() => { setSelected(t.id); onSelect(t) }}
          className={`w-full text-left card p-4 transition-all ${selected === t.id ? 'border-[#00ff88]' : 'hover:border-[#333333]'}`}
        >
          <div className="flex items-start gap-3">
            <span className="text-2xl">{t.emoji}</span>
            <div>
              <p className="font-semibold text-sm mb-1">{t.name}</p>
              <p className="text-[#888888] text-xs leading-relaxed">{t.description}</p>
            </div>
          </div>
        </motion.button>
      ))}
    </div>
  )
}
