'use client'
import { useState } from 'react'
import { TopBar } from '@/components/layout/TopBar'
import { WalletCard } from '@/components/wallet/WalletCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { Star, Plus, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface WatchlistItem {
  address: string
  label?: string
  archetype: string
  sharpe30d: number
  winRate: number
  totalPnl: number
  alphaDecay: number
}

interface Watchlist {
  id: string
  name: string
  wallets: WatchlistItem[]
}

export default function WatchlistPage() {
  const [watchlists, setWatchlists] = useState<Watchlist[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [activeList, setActiveList] = useState<string | null>(null)

  const handleCreate = () => {
    if (!newName.trim()) return
    const newList: Watchlist = {
      id: crypto.randomUUID(),
      name: newName,
      wallets: []
    }
    setWatchlists(prev => [...prev, newList])
    setActiveList(newList.id)
    setNewName('')
    setShowCreate(false)
  }

  const currentList = watchlists.find(w => w.id === activeList)

  return (
    <div>
      <TopBar title="Watchlist" />
      <div className="px-4 py-4 lg:px-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold mb-1">Watchlists</h2>
            <p className="text-[#8AADA9] text-xs">Track your favorite wallets in organized lists</p>
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-1 text-xs text-[#34EAB9] font-medium"
          >
            {showCreate ? <X size={14} /> : <Plus size={14} />}
            {showCreate ? 'Cancel' : 'New List'}
          </button>
        </div>

        <AnimatePresence>
          {showCreate && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="card p-4"
            >
              <label className="text-sm text-[#8AADA9] block mb-2">List Name</label>
              <div className="flex gap-2">
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g., Top Scalpers"
                  className="flex-1 bg-[#072724] border border-[#0D2E2A] rounded px-3 py-2.5 text-sm outline-none focus:border-[#34EAB9]"
                  onKeyDown={e => e.key === 'Enter' && handleCreate()}
                />
                <button
                  onClick={handleCreate}
                  disabled={!newName.trim()}
                  className="px-4 py-2.5 rounded bg-[#34EAB9] text-[#010E0C] text-sm font-semibold disabled:opacity-40"
                >
                  Create
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {watchlists.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-2">
            {watchlists.map(wl => (
              <button
                key={wl.id}
                onClick={() => setActiveList(wl.id)}
                className={`whitespace-nowrap text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                  activeList === wl.id
                    ? 'bg-[#34EAB9] text-[#010E0C]'
                    : 'bg-[#0C302C] text-[#8AADA9]'
                }`}
              >
                {wl.name} ({wl.wallets.length})
              </button>
            ))}
          </div>
        )}

        {watchlists.length === 0 && !showCreate ? (
          <EmptyState
            icon={<Star size={32} />}
            title="No Watchlists"
            description="Create a watchlist to start tracking your favorite wallets. Visit the Alpha Hunters page to find wallets to track."
            action={
              <button
                onClick={() => setShowCreate(true)}
                className="bg-[#34EAB9] text-[#010E0C] text-sm font-semibold px-4 py-2 rounded"
              >
                Create First Watchlist
              </button>
            }
          />
        ) : currentList ? (
          currentList.wallets.length > 0 ? (
            <div className="space-y-3">
              {currentList.wallets.map((w, i) => (
                <WalletCard
                  key={w.address}
                  address={w.address}
                  label={w.label}
                  archetype={w.archetype}
                  sharpe30d={w.sharpe30d}
                  winRate={w.winRate}
                  totalPnl={w.totalPnl}
                  alphaDecay={w.alphaDecay}
                  rank={i + 1}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-[#8AADA9] text-sm mb-2">No wallets in this list yet</p>
              <p className="text-xs text-[#8AADA9]">Browse the Alpha Hunters and tap the star icon to add wallets</p>
            </div>
          )
        ) : null}

        {currentList && currentList.wallets.length > 0 && (
          <div className="card p-4">
            <h3 className="font-semibold text-sm mb-3">Portfolio Summary</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-[#8AADA9] text-xs mb-1">Total PnL</p>
                <p className="font-mono font-semibold text-sm text-[#34EAB9]">
                  ${currentList.wallets.reduce((s, w) => s + w.totalPnl, 0).toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-[#8AADA9] text-xs mb-1">Avg Win Rate</p>
                <p className="font-mono font-semibold text-sm">
                  {(currentList.wallets.reduce((s, w) => s + w.winRate, 0) / currentList.wallets.length * 100).toFixed(0)}%
                </p>
              </div>
              <div>
                <p className="text-[#8AADA9] text-xs mb-1">Wallets</p>
                <p className="font-mono font-semibold text-sm">{currentList.wallets.length}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
