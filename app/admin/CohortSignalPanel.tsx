'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Loader2, Radio, ShieldAlert } from 'lucide-react'
import type { PulseCoin } from '@/lib/pulse/shape'

interface Preview {
  ok: boolean
  errors: string[]
  scoreable: { ok: boolean; errors: string[] }
  row: Record<string, unknown> | null
  telegram: { text: string; idPlaceholder: string } | null
  snapshot: (PulseCoin & { computedAt: string | null; live: boolean }) | null
}

const usd = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`
const PREVIEW_DEBOUNCE_MS = 400

/**
 * Publish one forward-looking Ledger call.
 *
 * The preview is computed SERVER-SIDE and rendered verbatim. This component
 * deliberately contains no copy of the publishing rules, the claim template,
 * or the subject grammar: it asks the server, which imports the real
 * publisher, the real scorer parser and the real Telegram formatter. A second
 * implementation here that drifted from those would be a form confidently
 * blessing a call the scorer cannot resolve.
 */
export function CohortSignalPanel() {
  const [coins, setCoins] = useState<PulseCoin[] | null>(null)
  const [menuError, setMenuError] = useState<string | null>(null)

  const [coin, setCoin] = useState('')
  const [direction, setDirection] = useState<'down' | 'up'>('down')
  const [confidence, setConfidence] = useState('0.55')

  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const [armed, setArmed] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [published, setPublished] = useState<Record<string, unknown> | null>(null)
  const [publishError, setPublishError] = useState<string[] | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    fetch('/api/admin/cohort-signal/preview', { cache: 'no-store' })
      .then(async (r) => {
        const d = await r.json()
        if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`)
        setCoins(d.coins)
      })
      .catch((e) => setMenuError(e.message))
  }, [])

  const refreshPreview = useCallback(async () => {
    if (!coin) { setPreview(null); return }
    setPreviewing(true)
    setPreviewError(null)
    try {
      const res = await fetch('/api/admin/cohort-signal/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coin, direction, confidence: Number(confidence), horizon_hours: 24 }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error || `HTTP ${res.status}`)
      setPreview(d)
    } catch (e) {
      setPreviewError((e as Error).message)
      setPreview(null)
    } finally {
      setPreviewing(false)
    }
  }, [coin, direction, confidence])

  // Any edit invalidates the arming: the confirm state must never survive a
  // change to what would be published.
  useEffect(() => {
    setArmed(false)
    setPublishError(null)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(refreshPreview, PREVIEW_DEBOUNCE_MS)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [refreshPreview])

  const publish = async () => {
    setPublishing(true)
    setPublishError(null)
    try {
      const res = await fetch('/api/admin/cohort-signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coin, direction, confidence: Number(confidence), horizon_hours: 24, confirm: true,
        }),
      })
      const d = await res.json()
      if (!res.ok) {
        setPublishError(Array.isArray(d?.errors) && d.errors.length ? d.errors : [d?.error || `HTTP ${res.status}`])
        return
      }
      setPublished(d.call)
      setArmed(false)
    } catch (e) {
      setPublishError([(e as Error).message])
    } finally {
      setPublishing(false)
    }
  }

  const selected = coins?.find((c) => c.coin === coin) ?? null
  const canPublish = Boolean(preview?.ok && preview.scoreable.ok && !previewing && !published)

  if (published) {
    const id = String(published.id)
    return (
      <div className="card p-4 space-y-3">
        <p className="text-xs font-semibold text-emerald-400">Published — Ledger call #{id}</p>
        <p className="text-[11px] text-white/45">
          The row is append-only and the Telegram post has been sent. Neither can be taken back;
          a mistake is corrected by publishing a second call beside it, never by editing this one.
        </p>
        <a
          href={`/ledger/${id}`}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-[#34EAB9] hover:underline"
        >
          /ledger/{id}
        </a>
        <pre className="text-[10px] font-mono bg-[#0B1316] p-3 rounded overflow-x-auto text-white/60">
          {JSON.stringify(published, null, 2)}
        </pre>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-2 border-l-2 border-l-amber-400">
        <p className="text-xs font-semibold flex items-center gap-1.5">
          <Radio size={12} className="text-amber-400" />
          Publishing is irreversible and public
        </p>
        <p className="text-[11px] text-white/45 max-w-3xl">
          Confirming writes an append-only <code className="font-mono">ledger_calls</code> row that no
          code path can edit or delete, and posts it to the public Telegram channel{' '}
          <span className="font-mono">@alphalens_ledger</span>. Both happen in the same action and
          neither has an undo. A wrong call is corrected by publishing another one beside it — the
          record of having been wrong is the product.
        </p>
        <p className="text-[10px] text-white/35 max-w-3xl">
          The row is built by <code className="font-mono">publishCohortSignal()</code> in{' '}
          <code className="font-mono">verify-service/lib/publish.mjs</code>, never by a direct insert.
          The snapshot is re-read server-side at preview and again at publish, so the call cites the
          reading it was actually published from.
        </p>
      </div>

      {menuError && (
        <div className="card p-3 border-l-2 border-l-[#FF3B5C] flex items-start gap-2">
          <AlertTriangle size={12} className="text-[#FF3B5C] mt-0.5 shrink-0" />
          <p className="text-[11px] text-[#FF3B5C]">
            The coin menu could not be read ({menuError}). Nothing is listed because the query
            failed — not because there is no positioning.
          </p>
        </div>
      )}

      <div className="card p-4 grid gap-3 sm:grid-cols-3">
        <label className="space-y-1">
          <span className="text-[10px] uppercase tracking-wide text-white/40">Coin</span>
          <select
            value={coin}
            onChange={(e) => setCoin(e.target.value)}
            className="w-full bg-[#0F1A1E] border border-white/[0.08] rounded px-2 py-1.5 text-xs"
          >
            <option value="">Select a coin…</option>
            {(coins || []).map((c) => (
              <option key={c.coin} value={c.coin}>
                {c.coin} — {usd(c.notionalUsd)}, {c.activeWallets}w, net{' '}
                {c.netFlowUsd >= 0 ? '+' : '−'}{usd(c.netFlowUsd)}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-[10px] uppercase tracking-wide text-white/40">Direction</span>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as 'down' | 'up')}
            className="w-full bg-[#0F1A1E] border border-white/[0.08] rounded px-2 py-1.5 text-xs"
          >
            <option value="down">down — price strictly lower at the horizon</option>
            <option value="up">up — price strictly higher at the horizon</option>
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-[10px] uppercase tracking-wide text-white/40">
            Confidence (0–1, exclusive)
          </span>
          <input
            value={confidence}
            onChange={(e) => setConfidence(e.target.value)}
            inputMode="decimal"
            className="w-full bg-[#0F1A1E] border border-white/[0.08] rounded px-2 py-1.5 text-xs font-mono"
          />
        </label>
      </div>

      {selected && (
        <div className="card p-3 text-[11px] text-white/55 flex flex-wrap gap-x-4 gap-y-1">
          <span>notional {usd(selected.notionalUsd)}</span>
          <span>net flow {selected.netFlowUsd >= 0 ? '+' : '−'}{usd(selected.netFlowUsd)}</span>
          <span>{selected.activeWallets} active wallets</span>
          <span>{selected.longPct}% long</span>
          <span className="text-white/35">horizon fixed at 24h</span>
        </div>
      )}

      {previewing && (
        <p className="text-[11px] text-white/40 flex items-center gap-1.5">
          <Loader2 size={11} className="animate-spin" /> Rebuilding the preview…
        </p>
      )}
      {previewError && (
        <div className="card p-3 border-l-2 border-l-[#FF3B5C]">
          <p className="text-[11px] text-[#FF3B5C]">Preview failed: {previewError}</p>
        </div>
      )}

      {preview && !preview.scoreable.ok && (
        <div className="card p-3 border-l-2 border-l-[#FF3B5C] space-y-1.5">
          <p className="text-[11px] font-semibold text-[#FF3B5C] flex items-center gap-1.5">
            <ShieldAlert size={12} /> The scorer cannot read this subject
          </p>
          <p className="text-[11px] text-white/55">
            <code className="font-mono">scoreableSubject()</code> in{' '}
            <code className="font-mono">verify-service/lib/scorer.mjs</code> rejects it. The database
            would accept this row anyway — <code className="font-mono">ledger_subject_ok</code> checks
            only the scope and the absence of wallet keys, never the coin or the direction. Published
            like this, it resolves <span className="font-mono">unresolvable</span> permanently and
            cannot be corrected.
          </p>
          <ul className="list-disc pl-4 text-[11px] text-[#FF3B5C]">
            {preview.scoreable.errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        </div>
      )}

      {preview && preview.errors.length > 0 && (
        <div className="card p-3 border-l-2 border-l-amber-400 space-y-1.5">
          <p className="text-[11px] font-semibold text-amber-400">Not publishable</p>
          <ul className="list-disc pl-4 text-[11px] text-amber-400">
            {preview.errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        </div>
      )}

      {preview?.row && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card p-4 space-y-2">
            <p className="text-xs font-semibold">The exact row</p>
            <p className="text-[10px] text-white/35">
              As <code className="font-mono">cohortSignalCall()</code> builds it.{' '}
              <code className="font-mono">published_at</code> is re-stamped at the moment of publish.
            </p>
            <pre className="text-[10px] font-mono bg-[#0B1316] p-3 rounded overflow-x-auto text-white/60 max-h-96">
              {JSON.stringify(preview.row, null, 2)}
            </pre>
          </div>

          <div className="card p-4 space-y-2">
            <p className="text-xs font-semibold">The exact Telegram post</p>
            <p className="text-[10px] text-white/35">
              Rendered by <code className="font-mono">formatCall()</code>, the same formatter the
              publisher uses. The call id shows as{' '}
              <code className="font-mono">{preview.telegram?.idPlaceholder}</code> because only the
              insert can assign it — it is labelled here rather than guessed.
            </p>
            <pre className="text-[11px] font-sans whitespace-pre-wrap bg-[#0B1316] p-3 rounded text-white/70 max-h-96 overflow-y-auto">
              {preview.telegram?.text}
            </pre>
          </div>
        </div>
      )}

      {publishError && (
        <div className="card p-3 border-l-2 border-l-[#FF3B5C] space-y-1">
          <p className="text-[11px] font-semibold text-[#FF3B5C]">Publish refused</p>
          <ul className="list-disc pl-4 text-[11px] text-[#FF3B5C]">
            {publishError.map((e) => <li key={e}>{e}</li>)}
          </ul>
        </div>
      )}

      <div className="card p-4 space-y-3">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={armed}
            disabled={!canPublish}
            onChange={(e) => setArmed(e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-[11px] text-white/60">
            I understand this writes a permanent, uneditable Ledger row{' '}
            <strong className="text-white/80">and broadcasts it publicly</strong> to{' '}
            <span className="font-mono">@alphalens_ledger</span>.
          </span>
        </label>

        <button
          onClick={publish}
          disabled={!canPublish || !armed || publishing}
          className="px-3 py-2 rounded text-xs font-semibold bg-[#34EAB9] text-[#0F1A1E]
                     disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          {publishing && <Loader2 size={12} className="animate-spin" />}
          {publishing ? 'Publishing…' : 'Publish call and post publicly'}
        </button>

        {!canPublish && !previewing && (
          <p className="text-[10px] text-white/35">
            Confirm stays disabled until the server-side preview succeeds and the scorer&apos;s own
            parser accepts the subject.
          </p>
        )}
      </div>
    </div>
  )
}
