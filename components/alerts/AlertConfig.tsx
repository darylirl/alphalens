'use client'
import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'

// Canonical archetype vocabulary — matches lib/wallets/classify.ts, the only
// source that actually writes archetypes.
const ARCHETYPE_OPTIONS = [
  'market_maker',
  'momentum_trader',
  'basis_trader',
  'whale',
  'scalper',
  'swing_trader',
]

export function AlertConfig() {
  const [telegramChatId, setTelegramChatId] = useState('')
  const [ntfyTopic, setNtfyTopic] = useState('')
  const [minPositionSize, setMinPositionSize] = useState(5000)
  const [selectedArchetypes, setSelectedArchetypes] = useState<string[]>([])

  const toggleArchetype = (a: string) => {
    setSelectedArchetypes(prev => prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a])
  }

  return (
    <div className="space-y-6">
      {/* Honesty note: alert delivery is not wired yet, and this form must
          never pretend to save. The save button stays disabled until a real
          persistence + delivery path exists. */}
      <div className="flex items-start gap-2 rounded border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2.5">
        <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-400/90 leading-relaxed">
          Alert delivery is not yet wired. Alerts configured now will activate
          when the signal pipeline ships — until then this form does not save.
        </p>
      </div>

      <div>
        <label className="text-sm text-white/55 block mb-2">Telegram Chat ID</label>
        <input
          value={telegramChatId}
          onChange={e => setTelegramChatId(e.target.value)}
          placeholder="Your Telegram chat ID"
          className="w-full bg-[#0F1A1E] border border-white/[0.08] rounded px-4 py-3 text-sm outline-none focus:border-[#34EAB9] transition-colors"
        />
        <p className="text-xs text-white/55 mt-1">Message @userinfobot on Telegram to get your chat ID</p>
      </div>

      <div>
        <label className="text-sm text-white/55 block mb-2">ntfy.sh Topic</label>
        <input
          value={ntfyTopic}
          onChange={e => setNtfyTopic(e.target.value)}
          placeholder="alphalens-your-unique-id"
          className="w-full bg-[#0F1A1E] border border-white/[0.08] rounded px-4 py-3 text-sm outline-none focus:border-[#34EAB9] transition-colors"
        />
        <p className="text-xs text-white/55 mt-1">Install the ntfy app and subscribe to this topic</p>
      </div>

      <div>
        <label className="text-sm text-white/55 block mb-2">Min Position Size (USD)</label>
        <input
          type="number"
          value={minPositionSize}
          onChange={e => setMinPositionSize(Number(e.target.value))}
          className="w-full bg-[#0F1A1E] border border-white/[0.08] rounded px-4 py-3 text-sm outline-none focus:border-[#34EAB9] transition-colors"
        />
      </div>

      <div>
        <label className="text-sm text-white/55 block mb-2">Filter by Trader Type</label>
        <div className="flex flex-wrap gap-2">
          {ARCHETYPE_OPTIONS.map(a => (
            <button
              key={a}
              onClick={() => toggleArchetype(a)}
              className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                selectedArchetypes.includes(a)
                  ? 'bg-[#34EAB9] text-[#0F1A1E]'
                  : 'bg-[#0F1A1E] text-white/55'
              }`}
            >
              {a.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </div>

      <button
        disabled
        title="Alert delivery is not yet wired"
        className="w-full py-4 rounded-lg font-semibold bg-white/[0.06] text-white/30 cursor-not-allowed"
      >
        Save Alert Settings — not yet available
      </button>
    </div>
  )
}
