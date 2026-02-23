'use client'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { ExternalLink, ArrowUpRight, ArrowDownRight, Settings } from 'lucide-react'

interface QuickTradeCardProps {
  asset: string
  side: 'Long' | 'Short'
  entryPrice: number
  suggestedSize?: number
  leverage?: number
  sourceWallet?: string
}

export function QuickTradeCard({
  asset,
  side,
  entryPrice,
  suggestedSize = 1000,
  leverage = 5,
  sourceWallet,
}: QuickTradeCardProps) {
  const [size, setSize] = useState(suggestedSize)
  const [lev, setLev] = useState(leverage)
  const [showSettings, setShowSettings] = useState(false)
  const isLong = side === 'Long'

  const margin = size / lev
  const liquidationPct = (1 / lev) * 100
  const liquidationPrice = isLong
    ? entryPrice * (1 - 1 / lev * 0.9)
    : entryPrice * (1 + 1 / lev * 0.9)

  const hyperliquidUrl = `https://app.hyperliquid.xyz/trade/${asset}`

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="card p-4"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`p-1 rounded ${isLong ? 'bg-[#34EAB920]' : 'bg-[#FF3B5C20]'}`}>
            {isLong ? <ArrowUpRight size={14} className="text-[#34EAB9]" /> : <ArrowDownRight size={14} className="text-[#FF3B5C]" />}
          </div>
          <div>
            <span className="font-bold text-sm">{asset}</span>
            <span className={`ml-2 text-xs font-semibold ${isLong ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
              {side.toUpperCase()}
            </span>
          </div>
        </div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="p-1.5 rounded hover:bg-white/[0.06] transition-colors text-white/55"
        >
          <Settings size={14} />
        </button>
      </div>

      {showSettings && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-3 mb-3">
          <div>
            <label className="text-[10px] text-white/40 block mb-1">Position Size (USD)</label>
            <input
              type="number"
              value={size}
              onChange={e => setSize(Number(e.target.value))}
              className="w-full bg-[#0F1A1E] border border-white/[0.08] rounded px-3 py-2 text-sm font-mono outline-none focus:border-[#34EAB9]"
            />
          </div>
          <div>
            <label className="text-[10px] text-white/40 block mb-1">Leverage</label>
            <div className="flex gap-2">
              {[1, 2, 5, 10, 20].map(l => (
                <button
                  key={l}
                  onClick={() => setLev(l)}
                  className={`flex-1 text-xs py-1.5 rounded transition-colors ${
                    lev === l ? 'bg-[#34EAB9] text-[#0F1A1E] font-semibold' : 'bg-[#0F1A1E] text-white/55'
                  }`}
                >
                  {l}x
                </button>
              ))}
            </div>
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-3 gap-2 mb-3 text-xs">
        <div className="bg-[#0F1A1E] rounded p-2">
          <p className="text-[9px] text-white/40 mb-0.5">Size</p>
          <p className="font-mono font-semibold">${size.toLocaleString()}</p>
        </div>
        <div className="bg-[#0F1A1E] rounded p-2">
          <p className="text-[9px] text-white/40 mb-0.5">Margin</p>
          <p className="font-mono font-semibold">${margin.toFixed(0)}</p>
        </div>
        <div className="bg-[#0F1A1E] rounded p-2">
          <p className="text-[9px] text-white/40 mb-0.5">Liq. Price</p>
          <p className="font-mono font-semibold text-[#FF3B5C]">${liquidationPrice.toFixed(2)}</p>
        </div>
      </div>

      <a
        href={hyperliquidUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`w-full flex items-center justify-center gap-2 py-3 rounded text-sm font-semibold transition-all hover:brightness-110 ${
          isLong ? 'bg-[#34EAB9] text-[#0F1A1E]' : 'bg-[#FF3B5C] text-white'
        }`}
      >
        <ExternalLink size={14} />
        Open {side} on Hyperliquid
      </a>

      {sourceWallet && (
        <p className="text-[9px] text-white/40 text-center mt-2">
          Mirroring {sourceWallet.slice(0, 6)}...{sourceWallet.slice(-4)} &middot; Pre-filled from signal
        </p>
      )}
    </motion.div>
  )
}
