'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, RefreshCw, Search, Tag, X } from 'lucide-react'
import { CopyableAddress } from '@/components/ui/CopyableAddress'

// Kept in step with VALID_ARCHETYPES in app/api/wallets/[address]/route.ts —
// the API filters anything else out, so offering a tag it would drop would be
// a control that silently does nothing.
const ARCHETYPES = [
  'market_maker', 'momentum_trader', 'basis_trader', 'whale', 'scalper', 'swing_trader',
] as const

const ARCHETYPE_LABELS: Record<string, string> = {
  market_maker: 'Market Maker',
  momentum_trader: 'Momentum',
  basis_trader: 'Basis Trader',
  whale: 'Whale',
  scalper: 'Scalper',
  swing_trader: 'Swing Trader',
  unclassified: 'Unclassified',
}

const ARCHETYPE_STYLES: Record<string, string> = {
  market_maker: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  momentum_trader: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  basis_trader: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  whale: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  scalper: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  swing_trader: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  unclassified: 'bg-white/[0.04] text-white/30 border-white/[0.06]',
}

interface Wallet {
  address: string
  label: string | null
  tags: string[]
  manually_tagged: boolean
  archetype: string | null
  capture_enabled: boolean
}

async function extractError(res: Response): Promise<string> {
  try {
    const body = await res.json()
    if (body?.error) return String(body.error)
  } catch { /* non-JSON body */ }
  return `HTTP ${res.status}`
}

export function WalletsPanel() {
  const [wallets, setWallets] = useState<Wallet[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [captureOnly, setCaptureOnly] = useState(false)
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [editingTags, setEditingTags] = useState<string | null>(null)
  const [tagDraft, setTagDraft] = useState<string[]>([])
  const [classifying, setClassifying] = useState(false)
  const [classifySummary, setClassifySummary] = useState<Record<string, number> | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/wallets', { cache: 'no-store' })
      if (!res.ok) throw new Error(await extractError(res))
      const data = await res.json()
      setWallets(
        (Array.isArray(data) ? data : []).map((w: Record<string, unknown>) => ({
          address: String(w.address || ''),
          label: w.label ? String(w.label) : null,
          tags: Array.isArray(w.tags) ? (w.tags as string[]) : [],
          manually_tagged: Boolean(w.manually_tagged),
          archetype: w.archetype ? String(w.archetype) : null,
          capture_enabled: Boolean(w.capture_enabled),
        })),
      )
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'could not load wallets')
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    let list = wallets || []
    if (captureOnly) list = list.filter((w) => w.capture_enabled)
    const q = search.trim().toLowerCase()
    if (q) list = list.filter((w) => w.address.toLowerCase().includes(q) || w.label?.toLowerCase().includes(q))
    return list
  }, [wallets, search, captureOnly])

  const captureCount = (wallets || []).filter((w) => w.capture_enabled).length

  const mark = (address: string, busy: boolean) =>
    setPending((p) => ({ ...p, [address]: busy }))

  /** PATCH one wallet field, optimistically, reverting on failure. */
  const patch = async (address: string, body: Record<string, unknown>, optimistic: Partial<Wallet>) => {
    const previous = (wallets || []).find((w) => w.address === address)
    if (!previous) return
    mark(address, true)
    setWallets((prev) => (prev || []).map((w) => (w.address === address ? { ...w, ...optimistic } : w)))
    try {
      const res = await fetch(`/api/wallets/${address}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await extractError(res))
      setError(null)
    } catch (e) {
      setWallets((prev) => (prev || []).map((w) => (w.address === address ? previous : w)))
      setError(`${address.slice(0, 10)}…: ${e instanceof Error ? e.message : 'network error'} — not saved, reverted.`)
    } finally {
      mark(address, false)
    }
  }

  const toggleCapture = (w: Wallet) =>
    patch(w.address, { capture_enabled: !w.capture_enabled }, { capture_enabled: !w.capture_enabled })

  const saveTags = async (address: string) => {
    const tags = tagDraft.length > 0 ? tagDraft : ['unclassified']
    setEditingTags(null)
    await patch(address, { tags }, { tags, manually_tagged: true })
  }

  const reclassify = async (address: string) => {
    mark(address, true)
    try {
      const res = await fetch(`/api/wallets/classify?address=${address}`, { method: 'POST' })
      if (!res.ok) throw new Error(await extractError(res))
      const d = await res.json()
      const tags = d.data?.results?.[0]?.tags || ['unclassified']
      setWallets((prev) => (prev || []).map((w) => (w.address === address ? { ...w, tags, manually_tagged: false } : w)))
      setError(null)
    } catch (e) {
      setError(`Reclassify failed: ${e instanceof Error ? e.message : 'network error'}`)
    } finally {
      mark(address, false)
    }
  }

  const reclassifyAll = async () => {
    setClassifying(true)
    setClassifySummary(null)
    try {
      const res = await fetch('/api/wallets/classify', { method: 'POST' })
      if (!res.ok) throw new Error(await extractError(res))
      const d = await res.json()
      setClassifySummary(d.data?.tagSummary || null)
      setError(null)
      await load()
    } catch (e) {
      setError(`Reclassify all failed: ${e instanceof Error ? e.message : 'network error'}`)
    } finally {
      setClassifying(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs font-semibold">Capture scope &amp; classification</p>
            <p className="text-[11px] text-white/45 max-w-2xl mt-1">
              <code className="font-mono">capture_enabled</code> is the enforced capacity budget: the
              daemon subscribes to and sweeps exactly these wallets. Turning it on adds a wallet to
              capture; turning it off stops new capture but keeps every fill already stored.
            </p>
          </div>
          <button
            onClick={reclassifyAll}
            disabled={classifying || !wallets?.length}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-[#34EAB9]/10 text-[#34EAB9] hover:bg-[#34EAB9]/20 transition-colors disabled:opacity-40"
          >
            <RefreshCw size={12} className={classifying ? 'animate-spin' : ''} />
            {classifying ? 'Classifying…' : 'Reclassify all'}
          </button>
        </div>
        <p className="text-[10px] text-white/35">
          {wallets === null
            ? 'Loading…'
            : `/api/wallets returned ${wallets.length} wallets, ${captureCount} of them capture-enabled. `
              + 'That endpoint returns the 500 most recently added, non-removed wallets — search and '
              + 'the filter below apply to that page only, not to every tracked wallet. It also reports '
              + 'a failed read as an empty list, so an empty table here is not evidence that nothing is tracked.'}
        </p>
      </div>

      {classifySummary && (
        <div className="card p-3 border-l-2 border-l-[#34EAB9]">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold">Classification complete</p>
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
      )}

      {(error || loadError) && (
        <div className="card p-3 border-l-2 border-l-[#FF3B5C] flex items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            <AlertTriangle size={12} className="text-[#FF3B5C] mt-0.5 shrink-0" />
            <p className="text-[11px] text-[#FF3B5C]">{loadError ? `Could not load wallets: ${loadError}` : error}</p>
          </div>
          <button onClick={() => { setError(null); setLoadError(null) }} className="text-white/30 hover:text-white/60 shrink-0">
            <X size={12} />
          </button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search the loaded page by address or label…"
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg pl-8 pr-3 py-2 text-xs text-[#F0FAF8] placeholder:text-white/25 focus:outline-none focus:border-[#34EAB9]/40"
          />
        </div>
        <label className="flex items-center gap-2 text-[11px] text-white/55 px-3 py-2 rounded-lg bg-white/[0.04] cursor-pointer">
          <input
            type="checkbox"
            checked={captureOnly}
            onChange={(e) => setCaptureOnly(e.target.checked)}
            className="w-3 h-3 rounded border-white/20 bg-white/5 accent-[#34EAB9]"
          />
          Capture-enabled only
        </label>
      </div>

      {wallets === null ? (
        <div className="card p-6 text-center text-xs text-white/40">Loading wallets…</div>
      ) : filtered.length === 0 ? (
        <div className="card p-6 text-center text-xs text-white/40">
          {wallets.length === 0
            ? '/api/wallets returned nothing. It answers a failed read with an empty list too, so this is '
              + 'not by itself evidence that no wallets are tracked.'
            : 'No wallets on this page match the search or filter.'}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-white/40 text-[10px] border-b border-white/[0.08]">
                  <th className="text-left py-2.5 px-4 font-medium">Wallet</th>
                  <th className="text-left py-2.5 px-2 font-medium">Tags</th>
                  <th className="text-left py-2.5 px-2 font-medium">Archetype</th>
                  <th className="text-center py-2.5 px-2 font-medium">Capture</th>
                  <th className="text-right py-2.5 px-4 font-medium">Classify</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((w) => (
                  <tr key={w.address} className="border-t border-white/[0.04] hover:bg-white/[0.02] transition-colors align-top">
                    <td className="py-2.5 px-4">
                      <CopyableAddress address={w.address} linked />
                      {w.label && <p className="text-[10px] text-white/45 mt-0.5">{w.label}</p>}
                    </td>
                    <td className="py-2.5 px-2 relative">
                      <div className="flex items-center gap-1 flex-wrap">
                        {(w.tags.filter((t) => t !== 'unclassified').length ? w.tags.filter((t) => t !== 'unclassified') : ['unclassified']).map((t) => (
                          <span key={t} className={`text-[8px] font-semibold px-1.5 py-0.5 rounded border ${ARCHETYPE_STYLES[t] || ARCHETYPE_STYLES.unclassified}`}>
                            {ARCHETYPE_LABELS[t] || t}
                          </span>
                        ))}
                        {w.manually_tagged && <span className="text-[7px] text-amber-400/60" title="Manually tagged">M</span>}
                        <button
                          onClick={() => {
                            setEditingTags(editingTags === w.address ? null : w.address)
                            setTagDraft(w.tags.filter((t) => (ARCHETYPES as readonly string[]).includes(t)))
                          }}
                          className="text-white/20 hover:text-white/50 transition-colors ml-0.5"
                          title="Edit archetype tags"
                        >
                          <Tag size={10} />
                        </button>
                      </div>
                      {editingTags === w.address && (
                        <div className="absolute z-50 top-full left-0 mt-1 card p-3 min-w-[200px] shadow-xl">
                          <p className="text-[10px] text-white/40 mb-2 uppercase tracking-wider">Select archetypes</p>
                          <div className="space-y-1.5">
                            {ARCHETYPES.map((tag) => (
                              <label key={tag} className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={tagDraft.includes(tag)}
                                  onChange={() => setTagDraft((p) => (p.includes(tag) ? p.filter((t) => t !== tag) : [...p, tag]))}
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
                              onClick={() => saveTags(w.address)}
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
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-2 text-[10px] text-white/45 font-mono">{w.archetype || '—'}</td>
                    <td className="py-2.5 px-2 text-center">
                      <button
                        role="switch"
                        aria-checked={w.capture_enabled}
                        aria-label={`Capture ${w.address}`}
                        disabled={pending[w.address]}
                        onClick={() => toggleCapture(w)}
                        className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors disabled:opacity-40 ${
                          w.capture_enabled ? 'bg-[#34EAB9]' : 'bg-white/[0.12]'
                        }`}
                      >
                        <span
                          className={`inline-block h-3 w-3 transform rounded-full bg-[#0F1A1E] transition-transform ${
                            w.capture_enabled ? 'translate-x-4' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        onClick={() => reclassify(w.address)}
                        disabled={pending[w.address]}
                        className="text-white/25 hover:text-[#34EAB9] transition-colors disabled:opacity-40"
                        title="Reclassify from Hyperliquid activity"
                      >
                        <RefreshCw size={11} className={pending[w.address] ? 'animate-spin' : ''} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
