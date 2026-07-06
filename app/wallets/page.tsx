'use client'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CopyableAddress } from '@/components/ui/CopyableAddress'
import { SkeletonCard } from '@/components/ui/SkeletonCard'
import { Search, Plus, RefreshCw, Trash2, Tag, Check, X, AlertTriangle, Lock } from 'lucide-react'
import { updateWalletLabelCache, updateWalletTagsCache } from '@/components/signals/SmartMoneyFeed'

// ─── Types ──────────────────────────────────────────────────────────────────

interface Wallet {
  address: string
  label: string | null
  tags: string[]
  manually_tagged: boolean
  total_pnl_usd: number
  win_rate: number
  archetype: string | null
  created_at: string
  sharpe_30d: number
}

// ─── Constants ──────────────────────────────────────────────────────────────

const ALL_ARCHETYPES = [
  'market_maker',
  'momentum_trader',
  'basis_trader',
  'whale',
  'scalper',
  'swing_trader',
] as const

const ARCHETYPE_STYLES: Record<string, string> = {
  market_maker: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  momentum_trader: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  basis_trader: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  whale: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  scalper: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  swing_trader: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  unclassified: 'bg-white/[0.04] text-white/30 border-white/[0.06]',
}

const ARCHETYPE_LABELS: Record<string, string> = {
  market_maker: 'Market Maker',
  momentum_trader: 'Momentum',
  basis_trader: 'Basis Trader',
  whale: 'Whale',
  scalper: 'Scalper',
  swing_trader: 'Swing Trader',
  unclassified: 'Unclassified',
}

const formatUsd = (n: number) => {
  const abs = Math.abs(n)
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `$${(abs / 1e3).toFixed(1)}K`
  return `$${abs.toFixed(0)}`
}

const EXAMPLE_ADDRESS = '0x010461C14e146ac35Fe42271BDC1134EE31C703a'

/** Pull a human-readable error out of a failed API response. */
async function extractError(res: Response): Promise<string> {
  try {
    const body = await res.json()
    if (body?.error) return String(body.error)
  } catch { /* non-JSON body */ }
  return `HTTP ${res.status}`
}

function errMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'network error'
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function WalletsPage() {
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState<string | null>(null)

  // Add wallet state
  const [newAddress, setNewAddress] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [adding, setAdding] = useState(false)
  const [addResult, setAddResult] = useState<{ success: boolean; message: string; tags?: string[] } | null>(null)

  // Bulk classify state
  const [classifying, setClassifying] = useState(false)
  const [classifySummary, setClassifySummary] = useState<Record<string, number> | null>(null)

  // Inline edit state
  const [editingLabel, setEditingLabel] = useState<string | null>(null)
  const [editLabelValue, setEditLabelValue] = useState('')

  // Tag edit state
  const [editingTags, setEditingTags] = useState<string | null>(null)
  const [tagDraft, setTagDraft] = useState<string[]>([])

  // Remove confirmation state
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)

  // Mutation failure feedback — set when a PATCH/DELETE fails and the UI reverts
  const [mutationError, setMutationError] = useState<string | null>(null)

  // Admin auth state — mutations require unlock when ADMIN_API_TOKEN is set
  const [authLocked, setAuthLocked] = useState(false)
  const [authorized, setAuthorized] = useState(true)
  const [unlockValue, setUnlockValue] = useState('')
  const [unlocking, setUnlocking] = useState(false)
  const [unlockError, setUnlockError] = useState<string | null>(null)

  // ─── Data fetching ──────────────────────────────────────────────────

  const fetchWallets = useCallback(async () => {
    try {
      const res = await fetch('/api/wallets')
      if (res.ok) {
        const data = await res.json()
        setWallets(
          (Array.isArray(data) ? data : []).map((w: Record<string, unknown>) => ({
            address: String(w.address || ''),
            label: w.label ? String(w.label) : null,
            tags: Array.isArray(w.tags) ? w.tags : [],
            manually_tagged: Boolean(w.manually_tagged),
            total_pnl_usd: Number(w.total_pnl_usd || 0),
            win_rate: Number(w.win_rate || 0),
            archetype: w.archetype ? String(w.archetype) : null,
            created_at: String(w.created_at || ''),
            sharpe_30d: Number(w.sharpe_30d || 0),
          }))
        )
      }
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchWallets() }, [fetchWallets])

  // Check whether the mutation API is locked behind an admin token
  useEffect(() => {
    fetch('/api/auth/unlock')
      .then(r => r.json())
      .then(d => {
        setAuthLocked(Boolean(d.locked))
        setAuthorized(Boolean(d.authorized))
      })
      .catch(() => { /* status check is best-effort; server still enforces */ })
  }, [])

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!unlockValue.trim()) return
    setUnlocking(true)
    setUnlockError(null)
    try {
      const res = await fetch('/api/auth/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: unlockValue }),
      })
      if (res.ok) {
        setAuthorized(true)
        setUnlockValue('')
      } else {
        const data = await res.json().catch(() => null)
        setUnlockError(data?.error || 'Invalid token')
      }
    } catch {
      setUnlockError('Network error')
    } finally {
      setUnlocking(false)
    }
  }

  // ─── Filtered list ──────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let list = wallets
    if (activeFilter) {
      list = list.filter(w => w.tags.includes(activeFilter))
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(w =>
        w.address.toLowerCase().includes(q) ||
        (w.label && w.label.toLowerCase().includes(q))
      )
    }
    return list
  }, [wallets, search, activeFilter])

  // ─── Add wallet ─────────────────────────────────────────────────────

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    const addr = newAddress.trim()

    if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
      setAddResult({ success: false, message: 'Invalid address. Must be a 42-character 0x Ethereum address.' })
      return
    }

    setAdding(true)
    setAddResult(null)

    try {
      const res = await fetch('/api/wallets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: addr, label: newLabel.trim() || null }),
      })
      const data = await res.json()

      if (res.ok && data.success) {
        const msg = data.warning
          ? `Wallet added. ${data.warning}`
          : `Wallet added and classified.`
        setAddResult({ success: true, message: msg, tags: data.tags })
        setNewAddress('')
        setNewLabel('')
        fetchWallets()
      } else {
        setAddResult({ success: false, message: data.error || 'Failed to add wallet' })
      }
    } catch {
      setAddResult({ success: false, message: 'Network error' })
    } finally {
      setAdding(false)
    }
  }

  // ─── Label editing ──────────────────────────────────────────────────

  const startEditLabel = (address: string, currentLabel: string | null) => {
    setEditingLabel(address)
    setEditLabelValue(currentLabel || '')
  }

  const saveLabel = async (address: string) => {
    const label = editLabelValue.trim() || null
    setEditingLabel(null)

    const previous = wallets.find(w => w.address === address)
    // No-op guard: also prevents the duplicate PATCH when Enter triggers blur
    if (!previous || previous.label === label) return

    // Optimistic update
    setWallets(prev => prev.map(w =>
      w.address === address ? { ...w, label } : w
    ))
    updateWalletLabelCache(address, label)

    try {
      const res = await fetch(`/api/wallets/${address}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      })
      if (!res.ok) throw new Error(await extractError(res))
    } catch (err) {
      // Revert optimistic update and surface the failure
      setWallets(prev => prev.map(w =>
        w.address === address ? { ...w, label: previous.label } : w
      ))
      updateWalletLabelCache(address, previous.label)
      setMutationError(`Label update failed: ${errMessage(err)}`)
    }
  }

  // ─── Tag editing ────────────────────────────────────────────────────

  const startEditTags = (address: string, currentTags: string[]) => {
    setEditingTags(address)
    setTagDraft([...currentTags.filter(t => ALL_ARCHETYPES.includes(t as typeof ALL_ARCHETYPES[number]))])
  }

  const toggleTagDraft = (tag: string) => {
    setTagDraft(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    )
  }

  const saveTags = async (address: string) => {
    const tags = tagDraft.length > 0 ? tagDraft : ['unclassified']
    setEditingTags(null)

    const previous = wallets.find(w => w.address === address)
    if (!previous) return

    // Optimistic update
    setWallets(prev => prev.map(w =>
      w.address === address ? { ...w, tags, manually_tagged: true } : w
    ))
    updateWalletTagsCache(address, tags)

    try {
      const res = await fetch(`/api/wallets/${address}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags }),
      })
      if (!res.ok) throw new Error(await extractError(res))
    } catch (err) {
      setWallets(prev => prev.map(w =>
        w.address === address
          ? { ...w, tags: previous.tags, manually_tagged: previous.manually_tagged }
          : w
      ))
      updateWalletTagsCache(address, previous.tags)
      setMutationError(`Tag update failed: ${errMessage(err)}`)
    }
  }

  // ─── Remove wallet ──────────────────────────────────────────────────

  const removeWallet = async (address: string) => {
    const index = wallets.findIndex(w => w.address === address)
    const previous = wallets[index]
    setConfirmRemove(null)
    if (!previous) return

    // Optimistic remove
    setWallets(prev => prev.filter(w => w.address !== address))

    try {
      const res = await fetch(`/api/wallets/${address}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await extractError(res))
    } catch (err) {
      // Restore the wallet at its original position
      setWallets(prev => {
        const next = [...prev]
        next.splice(Math.min(index, next.length), 0, previous)
        return next
      })
      setMutationError(`Remove failed: ${errMessage(err)}`)
    }
  }

  // ─── Reclassify all ─────────────────────────────────────────────────

  const reclassifyAll = async () => {
    setClassifying(true)
    setClassifySummary(null)
    try {
      const res = await fetch('/api/wallets/classify', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setClassifySummary(data.data?.tagSummary || null)
        fetchWallets()
      }
    } catch { /* ignore */ }
    finally { setClassifying(false) }
  }

  // ─── Reclassify single ──────────────────────────────────────────────

  const reclassifySingle = async (address: string) => {
    try {
      const res = await fetch(`/api/wallets/classify?address=${address}`, { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        const tags = data.data?.results?.[0]?.tags || ['unclassified']
        setWallets(prev => prev.map(w =>
          w.address === address ? { ...w, tags, manually_tagged: false } : w
        ))
      }
    } catch { /* ignore */ }
  }

  // ─── Render ─────────────────────────────────────────────────────────

  return (
    <div>
      <div className="px-4 py-4 lg:px-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold mb-0.5">Tracked Wallets</h2>
            <p className="text-white/55 text-xs">
              {wallets.length > 0
                ? `Managing ${wallets.length} wallet${wallets.length !== 1 ? 's' : ''}`
                : 'Add wallets to start tracking smart money activity'}
            </p>
          </div>
          <button
            onClick={reclassifyAll}
            disabled={classifying || wallets.length === 0}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-[#34EAB9]/10 text-[#34EAB9] hover:bg-[#34EAB9]/20 transition-colors disabled:opacity-40"
          >
            <RefreshCw size={12} className={classifying ? 'animate-spin' : ''} />
            {classifying ? 'Classifying...' : 'Reclassify All'}
          </button>
        </div>

        {/* Classification summary */}
        <AnimatePresence>
          {classifySummary && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="card p-3 border-l-2 border-l-[#34EAB9]">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold">Classification Complete</p>
                  <button onClick={() => setClassifySummary(null)} className="text-white/30 hover:text-white/60">
                    <X size={12} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(classifySummary).map(([tag, count]) => (
                    <span key={tag} className={`text-[10px] font-semibold px-2 py-1 rounded border ${ARCHETYPE_STYLES[tag] || ARCHETYPE_STYLES.unclassified}`}>
                      {ARCHETYPE_LABELS[tag] || tag}: {count}
                    </span>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Admin unlock banner — shown when mutations require a token and this session lacks one */}
        {authLocked && !authorized && (
          <div className="card p-3 border-l-2 border-l-amber-400">
            <div className="flex items-center gap-2 mb-2">
              <Lock size={12} className="text-amber-400 shrink-0" />
              <p className="text-xs text-amber-400">Wallet management is locked. Enter the admin token to add, edit, or remove wallets.</p>
            </div>
            <form onSubmit={handleUnlock} className="flex gap-2">
              <input
                type="password"
                value={unlockValue}
                onChange={e => setUnlockValue(e.target.value)}
                placeholder="Admin token"
                className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs font-mono text-[#F0FAF8] placeholder:text-white/25 focus:outline-none focus:border-amber-400/40"
              />
              <button
                type="submit"
                disabled={unlocking}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-400/10 text-amber-400 hover:bg-amber-400/20 transition-colors disabled:opacity-50"
              >
                {unlocking ? 'Unlocking...' : 'Unlock'}
              </button>
            </form>
            {unlockError && <p className="text-[10px] text-[#FF3B5C] mt-1.5">{unlockError}</p>}
          </div>
        )}

        {/* Mutation error banner — shown when a save/remove failed and was reverted */}
        <AnimatePresence>
          {mutationError && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="card p-3 border-l-2 border-l-[#FF3B5C] flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={12} className="text-[#FF3B5C] mt-0.5 shrink-0" />
                  <p className="text-xs text-[#FF3B5C]">{mutationError} Your change was not saved and has been reverted.</p>
                </div>
                <button onClick={() => setMutationError(null)} className="text-white/30 hover:text-white/60 shrink-0">
                  <X size={12} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Add wallet form */}
        <form onSubmit={handleAdd} className="card p-4">
          <p className="text-xs font-semibold mb-3 flex items-center gap-1.5">
            <Plus size={12} className="text-[#34EAB9]" />
            Add Wallet
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={newAddress}
              onChange={e => setNewAddress(e.target.value)}
              placeholder="0x... wallet address"
              className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-xs font-mono text-[#F0FAF8] placeholder:text-white/25 focus:outline-none focus:border-[#34EAB9]/40"
            />
            <input
              type="text"
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              placeholder="Label (optional)"
              className="sm:w-40 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-[#F0FAF8] placeholder:text-white/25 focus:outline-none focus:border-[#34EAB9]/40"
            />
            <button
              type="submit"
              disabled={adding}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-[#34EAB9] text-[#0F1A1E] hover:bg-[#2DD4A8] transition-colors disabled:opacity-50"
            >
              {adding ? 'Adding...' : 'Add'}
            </button>
          </div>

          {/* Add result feedback */}
          <AnimatePresence>
            {addResult && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className={`mt-3 text-xs flex items-start gap-2 ${addResult.success ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}
              >
                {addResult.success ? <Check size={12} className="mt-0.5 shrink-0" /> : <AlertTriangle size={12} className="mt-0.5 shrink-0" />}
                <div>
                  <p>{addResult.message}</p>
                  {addResult.tags && addResult.tags.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      {addResult.tags.map(t => (
                        <span key={t} className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${ARCHETYPE_STYLES[t] || ARCHETYPE_STYLES.unclassified}`}>
                          {ARCHETYPE_LABELS[t] || t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </form>

        {/* Search and filters */}
        {wallets.length > 0 && (
          <div className="space-y-2">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by address or label..."
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg pl-8 pr-3 py-2 text-xs text-[#F0FAF8] placeholder:text-white/25 focus:outline-none focus:border-[#34EAB9]/40"
              />
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              <button
                onClick={() => setActiveFilter(null)}
                className={`whitespace-nowrap text-[10px] font-medium px-2.5 py-1 rounded-full transition-colors ${
                  !activeFilter ? 'bg-[#34EAB9] text-[#0F1A1E]' : 'bg-[#0F1A1E] text-white/55 hover:text-white/80'
                }`}
              >
                All
              </button>
              {ALL_ARCHETYPES.map(tag => (
                <button
                  key={tag}
                  onClick={() => setActiveFilter(activeFilter === tag ? null : tag)}
                  className={`whitespace-nowrap text-[10px] font-medium px-2.5 py-1 rounded-full transition-colors ${
                    activeFilter === tag ? 'bg-[#34EAB9] text-[#0F1A1E]' : 'bg-[#0F1A1E] text-white/55 hover:text-white/80'
                  }`}
                >
                  {ARCHETYPE_LABELS[tag]}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Wallet list */}
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map(i => <SkeletonCard key={i} />)}
          </div>
        ) : wallets.length === 0 ? (
          /* Empty state */
          <div className="card p-8 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[#34EAB9]/10 mb-4">
              <Plus size={20} className="text-[#34EAB9]" />
            </div>
            <h3 className="font-semibold text-sm mb-2">No wallets tracked yet</h3>
            <p className="text-white/40 text-xs mb-4 max-w-md mx-auto">
              Add your first wallet to start tracking smart money activity, receiving signals, and analyzing trading patterns.
            </p>
            <button
              onClick={() => {
                setNewAddress(EXAMPLE_ADDRESS)
                setNewLabel('Example Trader')
              }}
              className="text-xs text-[#34EAB9] hover:underline"
            >
              Try with example address
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="card p-6 text-center">
            <p className="text-white/40 text-xs">No wallets match your search or filter.</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-white/40 text-[10px] border-b border-white/[0.08]">
                      <th className="text-left py-3 px-4 font-medium">Wallet</th>
                      <th className="text-left py-3 px-2 font-medium">Label</th>
                      <th className="text-left py-3 px-2 font-medium">Tags</th>
                      <th className="text-right py-3 px-2 font-medium">PnL</th>
                      <th className="text-right py-3 px-2 font-medium">Win Rate</th>
                      <th className="text-right py-3 px-2 font-medium">Added</th>
                      <th className="text-right py-3 px-4 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(w => (
                      <WalletTableRow
                        key={w.address}
                        wallet={w}
                        editingLabel={editingLabel}
                        editLabelValue={editLabelValue}
                        setEditLabelValue={setEditLabelValue}
                        startEditLabel={startEditLabel}
                        saveLabel={saveLabel}
                        editingTags={editingTags}
                        tagDraft={tagDraft}
                        startEditTags={startEditTags}
                        toggleTagDraft={toggleTagDraft}
                        saveTags={saveTags}
                        setEditingTags={setEditingTags}
                        confirmRemove={confirmRemove}
                        setConfirmRemove={setConfirmRemove}
                        removeWallet={removeWallet}
                        reclassifySingle={reclassifySingle}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile card view */}
            <div className="md:hidden space-y-3">
              {filtered.map(w => (
                <WalletCard
                  key={w.address}
                  wallet={w}
                  editingLabel={editingLabel}
                  editLabelValue={editLabelValue}
                  setEditLabelValue={setEditLabelValue}
                  startEditLabel={startEditLabel}
                  saveLabel={saveLabel}
                  editingTags={editingTags}
                  tagDraft={tagDraft}
                  startEditTags={startEditTags}
                  toggleTagDraft={toggleTagDraft}
                  saveTags={saveTags}
                  setEditingTags={setEditingTags}
                  confirmRemove={confirmRemove}
                  setConfirmRemove={setConfirmRemove}
                  removeWallet={removeWallet}
                  reclassifySingle={reclassifySingle}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Shared props for wallet rows/cards ───────────────────────────────────

interface WalletItemProps {
  wallet: Wallet
  editingLabel: string | null
  editLabelValue: string
  setEditLabelValue: (v: string) => void
  startEditLabel: (address: string, label: string | null) => void
  saveLabel: (address: string) => void
  editingTags: string | null
  tagDraft: string[]
  startEditTags: (address: string, tags: string[]) => void
  toggleTagDraft: (tag: string) => void
  saveTags: (address: string) => void
  setEditingTags: (address: string | null) => void
  confirmRemove: string | null
  setConfirmRemove: (address: string | null) => void
  removeWallet: (address: string) => void
  reclassifySingle: (address: string) => void
}

// ─── Tag Edit Popover ─────────────────────────────────────────────────────

function TagEditor({ address, tagDraft, toggleTagDraft, saveTags, setEditingTags }: {
  address: string
  tagDraft: string[]
  toggleTagDraft: (tag: string) => void
  saveTags: (address: string) => void
  setEditingTags: (address: string | null) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setEditingTags(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [setEditingTags])

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="absolute z-50 top-full left-0 mt-1 card p-3 min-w-[200px] shadow-xl"
    >
      <p className="text-[10px] text-white/40 mb-2 uppercase tracking-wider">Select archetypes</p>
      <div className="space-y-1.5">
        {ALL_ARCHETYPES.map(tag => (
          <label key={tag} className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={tagDraft.includes(tag)}
              onChange={() => toggleTagDraft(tag)}
              className="w-3 h-3 rounded border-white/20 bg-white/5 accent-[#34EAB9]"
            />
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${ARCHETYPE_STYLES[tag]}`}>
              {ARCHETYPE_LABELS[tag]}
            </span>
          </label>
        ))}
      </div>
      <div className="flex gap-2 mt-3">
        <button
          onClick={() => saveTags(address)}
          className="flex-1 text-[10px] font-semibold py-1.5 rounded bg-[#34EAB9] text-[#0F1A1E] hover:bg-[#2DD4A8] transition-colors"
        >
          Save
        </button>
        <button
          onClick={() => setEditingTags(null)}
          className="flex-1 text-[10px] font-semibold py-1.5 rounded bg-white/5 text-white/55 hover:text-white/80 transition-colors"
        >
          Cancel
        </button>
      </div>
    </motion.div>
  )
}

// ─── Desktop Table Row ────────────────────────────────────────────────────

function WalletTableRow(props: WalletItemProps) {
  const { wallet: w, editingLabel, editLabelValue, setEditLabelValue, startEditLabel, saveLabel,
    editingTags, tagDraft, startEditTags, toggleTagDraft, saveTags, setEditingTags,
    confirmRemove, setConfirmRemove, removeWallet, reclassifySingle } = props

  const pnl = w.total_pnl_usd
  const dateAdded = w.created_at ? new Date(w.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }) : '—'

  return (
    <tr className="border-t border-white/[0.04] hover:bg-white/[0.02] transition-colors">
      <td className="py-3 px-4">
        <CopyableAddress address={w.address} linked />
      </td>
      <td className="py-3 px-2">
        {editingLabel === w.address ? (
          <input
            autoFocus
            value={editLabelValue}
            onChange={e => setEditLabelValue(e.target.value)}
            onBlur={() => saveLabel(w.address)}
            onKeyDown={e => { if (e.key === 'Enter') saveLabel(w.address); if (e.key === 'Escape') { setEditLabelValue(''); saveLabel(w.address) } }}
            className="bg-white/[0.06] border border-[#34EAB9]/30 rounded px-2 py-1 text-xs text-[#F0FAF8] focus:outline-none w-32"
          />
        ) : (
          <button
            onClick={() => startEditLabel(w.address, w.label)}
            className="text-xs text-white/70 hover:text-[#34EAB9] transition-colors cursor-text"
          >
            {w.label || <span className="text-white/25 italic">Click to add label</span>}
          </button>
        )}
      </td>
      <td className="py-3 px-2">
        <div className="relative">
          <div className="flex items-center gap-1">
            {w.tags.filter(t => t !== 'unclassified').length > 0 ? (
              w.tags.filter(t => t !== 'unclassified').map(t => (
                <span key={t} className={`text-[8px] font-semibold px-1.5 py-0.5 rounded border ${ARCHETYPE_STYLES[t] || ARCHETYPE_STYLES.unclassified}`}>
                  {ARCHETYPE_LABELS[t] || t}
                </span>
              ))
            ) : (
              <span className={`text-[8px] font-semibold px-1.5 py-0.5 rounded border ${ARCHETYPE_STYLES.unclassified}`}>
                Unclassified
              </span>
            )}
            {w.manually_tagged && (
              <span className="text-[7px] text-amber-400/60" title="Manually tagged">M</span>
            )}
            <button
              onClick={() => startEditTags(w.address, w.tags)}
              className="text-white/20 hover:text-white/50 transition-colors ml-0.5"
            >
              <Tag size={10} />
            </button>
          </div>
          <AnimatePresence>
            {editingTags === w.address && (
              <TagEditor
                address={w.address}
                tagDraft={tagDraft}
                toggleTagDraft={toggleTagDraft}
                saveTags={saveTags}
                setEditingTags={setEditingTags}
              />
            )}
          </AnimatePresence>
        </div>
      </td>
      <td className={`py-3 px-2 text-right font-mono ${pnl >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
        {pnl !== 0 ? `${pnl >= 0 ? '+' : '-'}${formatUsd(pnl)}` : '—'}
      </td>
      <td className="py-3 px-2 text-right font-mono text-white/55">
        {w.win_rate > 0 ? `${(w.win_rate * 100).toFixed(0)}%` : '—'}
      </td>
      <td className="py-3 px-2 text-right text-[10px] text-white/40">
        {dateAdded}
      </td>
      <td className="py-3 px-4 text-right">
        {confirmRemove === w.address ? (
          <div className="flex items-center gap-1.5 justify-end">
            <span className="text-[10px] text-white/40">Remove?</span>
            <button onClick={() => removeWallet(w.address)} className="text-[10px] font-semibold text-[#FF3B5C] hover:text-[#FF5C7A]">
              Yes
            </button>
            <button onClick={() => setConfirmRemove(null)} className="text-[10px] text-white/40 hover:text-white/60">
              No
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 justify-end">
            <button onClick={() => reclassifySingle(w.address)} className="text-white/25 hover:text-[#34EAB9] transition-colors" title="Reclassify">
              <RefreshCw size={11} />
            </button>
            <button onClick={() => setConfirmRemove(w.address)} className="text-white/25 hover:text-[#FF3B5C] transition-colors" title="Remove">
              <Trash2 size={11} />
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}

// ─── Mobile Card ──────────────────────────────────────────────────────────

function WalletCard(props: WalletItemProps) {
  const { wallet: w, editingLabel, editLabelValue, setEditLabelValue, startEditLabel, saveLabel,
    editingTags, tagDraft, startEditTags, toggleTagDraft, saveTags, setEditingTags,
    confirmRemove, setConfirmRemove, removeWallet, reclassifySingle } = props

  const pnl = w.total_pnl_usd

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="card p-4"
    >
      <div className="flex items-start justify-between mb-2">
        <CopyableAddress address={w.address} linked />
        <div className="flex items-center gap-2">
          <button onClick={() => reclassifySingle(w.address)} className="text-white/25 hover:text-[#34EAB9] transition-colors">
            <RefreshCw size={12} />
          </button>
          <button onClick={() => setConfirmRemove(w.address)} className="text-white/25 hover:text-[#FF3B5C] transition-colors">
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Label */}
      <div className="mb-2">
        {editingLabel === w.address ? (
          <input
            autoFocus
            value={editLabelValue}
            onChange={e => setEditLabelValue(e.target.value)}
            onBlur={() => saveLabel(w.address)}
            onKeyDown={e => { if (e.key === 'Enter') saveLabel(w.address) }}
            className="bg-white/[0.06] border border-[#34EAB9]/30 rounded px-2 py-1 text-xs text-[#F0FAF8] focus:outline-none w-full"
          />
        ) : (
          <button
            onClick={() => startEditLabel(w.address, w.label)}
            className="text-xs text-white/70 hover:text-[#34EAB9] transition-colors"
          >
            {w.label || <span className="text-white/25 italic">Tap to add label</span>}
          </button>
        )}
      </div>

      {/* Tags */}
      <div className="relative mb-3">
        <div className="flex items-center gap-1 flex-wrap">
          {w.tags.filter(t => t !== 'unclassified').length > 0 ? (
            w.tags.filter(t => t !== 'unclassified').map(t => (
              <span key={t} className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${ARCHETYPE_STYLES[t] || ARCHETYPE_STYLES.unclassified}`}>
                {ARCHETYPE_LABELS[t] || t}
              </span>
            ))
          ) : (
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${ARCHETYPE_STYLES.unclassified}`}>
              Unclassified
            </span>
          )}
          {w.manually_tagged && (
            <span className="text-[7px] text-amber-400/60">Manual</span>
          )}
          <button
            onClick={() => startEditTags(w.address, w.tags)}
            className="text-white/20 hover:text-white/50 transition-colors"
          >
            <Tag size={11} />
          </button>
        </div>
        <AnimatePresence>
          {editingTags === w.address && (
            <TagEditor
              address={w.address}
              tagDraft={tagDraft}
              toggleTagDraft={toggleTagDraft}
              saveTags={saveTags}
              setEditingTags={setEditingTags}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-[#0F1A1E] rounded p-2">
          <p className="text-[9px] text-white/40 mb-0.5">PnL</p>
          <p className={`font-mono text-xs font-semibold ${pnl >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
            {pnl !== 0 ? `${pnl >= 0 ? '+' : '-'}${formatUsd(pnl)}` : '—'}
          </p>
        </div>
        <div className="bg-[#0F1A1E] rounded p-2">
          <p className="text-[9px] text-white/40 mb-0.5">Win Rate</p>
          <p className="font-mono text-xs font-semibold">
            {w.win_rate > 0 ? `${(w.win_rate * 100).toFixed(0)}%` : '—'}
          </p>
        </div>
        <div className="bg-[#0F1A1E] rounded p-2">
          <p className="text-[9px] text-white/40 mb-0.5">Added</p>
          <p className="text-[10px] text-white/55">
            {w.created_at ? new Date(w.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}
          </p>
        </div>
      </div>

      {/* Inline remove confirmation */}
      <AnimatePresence>
        {confirmRemove === w.address && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.06]">
              <span className="text-[10px] text-white/40">Remove this wallet from tracking?</span>
              <div className="flex gap-2">
                <button onClick={() => removeWallet(w.address)} className="text-[10px] font-semibold text-[#FF3B5C] hover:text-[#FF5C7A]">
                  Confirm
                </button>
                <button onClick={() => setConfirmRemove(null)} className="text-[10px] text-white/40 hover:text-white/60">
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
