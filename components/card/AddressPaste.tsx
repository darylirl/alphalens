'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Paste-only entry: any valid address gets a card/replay — no wallet connect,
// no login, nothing signed.

export function AddressPaste({ basePath }: { basePath: '/card' | '/replay' }) {
  const [value, setValue] = useState('')
  const [bad, setBad] = useState(false)
  const router = useRouter()

  const go = () => {
    const trimmed = value.trim()
    if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
      setBad(false)
      router.push(`${basePath}/${trimmed.toLowerCase()}`)
    } else {
      setBad(true)
    }
  }

  return (
    <div>
      <div className="flex gap-2">
        <input
          value={value}
          onChange={e => {
            setValue(e.target.value)
            setBad(false)
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') go()
          }}
          placeholder="Paste any wallet address (0x…)"
          spellCheck={false}
          className="flex-1 min-w-0 bg-[#0A1417] border border-white/[0.12] rounded px-3 py-2 font-mono text-xs text-[#F0FAF8] placeholder:text-white/25 focus:border-[#34EAB9]/60 focus:outline-none"
        />
        <button
          type="button"
          onClick={go}
          className="bg-[#34EAB9] text-[#0F1A1E] font-semibold text-[11px] px-3 py-1.5 rounded hover:brightness-110 transition-all shrink-0"
        >
          Go
        </button>
      </div>
      {bad && (
        <p className="text-[10px] text-[#FF3B5C] mt-1">
          That is not a wallet address — expected 0x followed by 40 hex characters.
        </p>
      )}
    </div>
  )
}
