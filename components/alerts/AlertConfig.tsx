'use client'
import { useState } from 'react'

interface AlertConfigProps {
  onSave: (config: {
    telegramChatId: string
    ntfyTopic: string
    minPositionSize: number
    archetypesFilter: string[]
  }) => void
}

const ARCHETYPE_OPTIONS = ['scalper', 'swing_trader', 'momentum_trader', 'high_conviction', 'funding_arb']

export function AlertConfig({ onSave }: AlertConfigProps) {
  const [telegramChatId, setTelegramChatId] = useState('')
  const [ntfyTopic, setNtfyTopic] = useState('')
  const [minPositionSize, setMinPositionSize] = useState(5000)
  const [selectedArchetypes, setSelectedArchetypes] = useState<string[]>([])

  const toggleArchetype = (a: string) => {
    setSelectedArchetypes(prev => prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a])
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="text-sm text-[#888888] block mb-2">Telegram Chat ID</label>
        <input
          value={telegramChatId}
          onChange={e => setTelegramChatId(e.target.value)}
          placeholder="Your Telegram chat ID"
          className="w-full bg-[#161616] border border-[#222222] rounded-xl px-4 py-3 text-sm outline-none focus:border-[#00ff88] transition-colors"
        />
        <p className="text-xs text-[#888888] mt-1">Message @userinfobot on Telegram to get your chat ID</p>
      </div>

      <div>
        <label className="text-sm text-[#888888] block mb-2">ntfy.sh Topic</label>
        <input
          value={ntfyTopic}
          onChange={e => setNtfyTopic(e.target.value)}
          placeholder="alphalens-your-unique-id"
          className="w-full bg-[#161616] border border-[#222222] rounded-xl px-4 py-3 text-sm outline-none focus:border-[#00ff88] transition-colors"
        />
        <p className="text-xs text-[#888888] mt-1">Install the ntfy app and subscribe to this topic</p>
      </div>

      <div>
        <label className="text-sm text-[#888888] block mb-2">Min Position Size (USD)</label>
        <input
          type="number"
          value={minPositionSize}
          onChange={e => setMinPositionSize(Number(e.target.value))}
          className="w-full bg-[#161616] border border-[#222222] rounded-xl px-4 py-3 text-sm outline-none focus:border-[#00ff88] transition-colors"
        />
      </div>

      <div>
        <label className="text-sm text-[#888888] block mb-2">Filter by Trader Type</label>
        <div className="flex flex-wrap gap-2">
          {ARCHETYPE_OPTIONS.map(a => (
            <button
              key={a}
              onClick={() => toggleArchetype(a)}
              className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                selectedArchetypes.includes(a)
                  ? 'bg-[#00ff88] text-black'
                  : 'bg-[#161616] text-[#888888]'
              }`}
            >
              {a.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={() => onSave({ telegramChatId, ntfyTopic, minPositionSize, archetypesFilter: selectedArchetypes })}
        className="w-full py-4 rounded-2xl font-semibold bg-[#00ff88] text-black transition-opacity hover:opacity-90"
      >
        Save Alert Settings
      </button>
    </div>
  )
}
