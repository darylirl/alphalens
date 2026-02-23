'use client'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { useWallet } from '@/lib/wallet/WalletContext'
import { Copy, Wallet, Plus, ToggleLeft, ToggleRight, Trash2, ExternalLink } from 'lucide-react'

interface CopyConfig {
  target_address: string
  ratio: number
  max_position_size: number
  enabled: boolean
}

export default function CopyTradePage() {
  const { address, connect, connecting } = useWallet()
  const [configs, setConfigs] = useState<CopyConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [newTarget, setNewTarget] = useState('')
  const [newRatio, setNewRatio] = useState(100)
  const [newMaxSize, setNewMaxSize] = useState(10000)

  useEffect(() => {
    if (address) loadConfigs()
  }, [address])

  async function loadConfigs() {
    setLoading(true)
    try {
      const res = await fetch(`/api/copy-trade?user=${address}`)
      if (res.ok) {
        const data = await res.json()
        setConfigs(data.configs || [])
      }
    } catch {} finally {
      setLoading(false)
    }
  }

  async function addConfig() {
    if (!newTarget.startsWith('0x') || newTarget.length < 10) return
    try {
      const res = await fetch('/api/copy-trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAddress: address,
          targetAddress: newTarget,
          ratio: newRatio,
          maxPositionSize: newMaxSize,
        }),
      })
      if (res.ok) {
        setShowAdd(false)
        setNewTarget('')
        setNewRatio(100)
        setNewMaxSize(10000)
        loadConfigs()
      }
    } catch {}
  }

  async function toggleConfig(target: string, enabled: boolean) {
    await fetch('/api/copy-trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userAddress: address, targetAddress: target, enabled }),
    })
    loadConfigs()
  }

  if (!address) {
    return (
      <div>
        <div className="px-4 py-16 text-center">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <div className="w-16 h-16 mx-auto mb-4 rounded-lg bg-[#0F1A1E] flex items-center justify-center">
              <Wallet size={28} className="text-[#34EAB9]" />
            </div>
            <h2 className="text-lg font-bold mb-2">Connect Your Wallet</h2>
            <p className="text-white/55 text-sm mb-6 max-w-sm mx-auto">
              Connect your wallet to copy trade top-performing Hyperliquid traders automatically.
            </p>
            <button
              onClick={connect}
              disabled={connecting}
              className="bg-[#34EAB9] text-[#0F1A1E] font-semibold px-6 py-3 rounded text-sm hover:bg-[#2BD4A6] transition-colors disabled:opacity-50"
            >
              {connecting ? 'Connecting...' : 'Connect Wallet'}
            </button>
            <p className="text-white/40 text-xs mt-4">
              Supports MetaMask, WalletConnect, and other EIP-1193 wallets
            </p>
          </motion.div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="px-4 py-4 lg:px-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold mb-1">Copy Trading</h2>
            <p className="text-white/55 text-xs">
              Auto-mirror positions from top traders &middot; Connected: {address.slice(0, 6)}...{address.slice(-4)}
            </p>
          </div>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-1.5 bg-[#34EAB9] text-[#0F1A1E] text-xs font-semibold px-3 py-2 rounded"
          >
            <Plus size={14} />
            Add Trader
          </button>
        </div>

        {showAdd && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="card p-4 space-y-3">
            <div>
              <label className="text-xs text-white/55 mb-1 block">Trader Wallet Address</label>
              <input
                value={newTarget}
                onChange={e => setNewTarget(e.target.value)}
                placeholder="0x..."
                className="w-full bg-[#0F1A1E] border border-white/[0.08] rounded px-3 py-2.5 text-sm outline-none focus:border-[#34EAB9]"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-white/55 mb-1 block">Copy Ratio (%)</label>
                <input
                  type="number"
                  value={newRatio}
                  onChange={e => setNewRatio(Number(e.target.value))}
                  className="w-full bg-[#0F1A1E] border border-white/[0.08] rounded px-3 py-2.5 text-sm outline-none focus:border-[#34EAB9]"
                />
              </div>
              <div>
                <label className="text-xs text-white/55 mb-1 block">Max Position (USD)</label>
                <input
                  type="number"
                  value={newMaxSize}
                  onChange={e => setNewMaxSize(Number(e.target.value))}
                  className="w-full bg-[#0F1A1E] border border-white/[0.08] rounded px-3 py-2.5 text-sm outline-none focus:border-[#34EAB9]"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={addConfig} className="bg-[#34EAB9] text-[#0F1A1E] text-sm font-semibold px-4 py-2 rounded">
                Save
              </button>
              <button onClick={() => setShowAdd(false)} className="text-white/55 text-sm px-4 py-2">
                Cancel
              </button>
            </div>
          </motion.div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[1, 2].map(i => (
              <div key={i} className="card p-4 animate-pulse">
                <div className="h-4 bg-[#0F1A1E] rounded w-1/3 mb-2" />
                <div className="h-3 bg-[#0F1A1E] rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : configs.length > 0 ? (
          <div className="space-y-3">
            {configs.map((c, i) => (
              <motion.div
                key={c.target_address}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="card p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Copy size={14} className="text-[#34EAB9]" />
                    <span className="font-mono text-sm">
                      {c.target_address.slice(0, 6)}...{c.target_address.slice(-4)}
                    </span>
                    <Link href={`/wallet/${c.target_address}`}>
                      <ExternalLink size={12} className="text-white/55 hover:text-[#34EAB9]" />
                    </Link>
                  </div>
                  <button onClick={() => toggleConfig(c.target_address, !c.enabled)}>
                    {c.enabled ? (
                      <ToggleRight size={24} className="text-[#34EAB9]" />
                    ) : (
                      <ToggleLeft size={24} className="text-white/55" />
                    )}
                  </button>
                </div>
                <div className="flex gap-4 text-xs text-white/55">
                  <span>Ratio: <span className="font-mono text-[#F0FAF8]">{c.ratio}%</span></span>
                  <span>Max: <span className="font-mono text-[#F0FAF8]">${c.max_position_size.toLocaleString()}</span></span>
                  <span>Status: <span className={c.enabled ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}>{c.enabled ? 'Active' : 'Paused'}</span></span>
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="card p-8 text-center">
            <Copy size={24} className="mx-auto mb-3 text-white/55" />
            <p className="text-white/55 text-sm mb-2">No copy trades configured</p>
            <p className="text-white/40 text-xs">
              Find a trader on the{' '}
              <Link href="/hunters" className="text-[#34EAB9]">Alpha Hunters</Link>
              {' '}page and add them here
            </p>
          </div>
        )}

        <div className="card p-4">
          <h3 className="font-semibold text-sm mb-2">How Copy Trading Works</h3>
          <div className="space-y-2 text-xs text-white/55">
            <p>1. Find profitable traders on the Alpha Hunters leaderboard</p>
            <p>2. Add their wallet address and set your copy ratio</p>
            <p>3. When they open/close positions, yours mirror automatically</p>
            <p>4. Set max position size to manage your risk</p>
          </div>
        </div>
      </div>
    </div>
  )
}
