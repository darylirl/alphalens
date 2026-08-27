'use client'
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'

/**
 * Publish a forward-looking cohort_signal.
 *
 * The only surface in this console that writes something irreversible. A
 * hypothesis_verdict call restates evidence that already exists; a signal is
 * published BEFORE its evidence and settled later, and ledger_calls is
 * append-only — so a call the scorer cannot read does not fail loudly, it sits
 * until its horizon and resolves 'unresolvable', permanently, with no Brier
 * score. That is a hole in the calibration curve wearing a data gap's clothes.
 *
 * So this form decides nothing. It reads /api/pulse to populate the picker,
 * and every check that matters runs server-side against the snapshot the
 * SERVICE fetched: the scorer's own scoreableSubject() on the exact subject,
 * the direction/skew/wallet/notional floors in publish.mjs, capture liveness,
 * and a tape preflight through the scorer's own priceAt. Preview and publish
 * are the same route and the same modules.
 */

type PulseCoin = {
  coin: string
  notionalUsd: number
  netFlowUsd: number
  longPct: number
  activeWallets: number
}

type Row = {
  published_at: string
  kind: string
  subject: { scope: string; coin: string; direction: string }
  claim: string
  confidence: number
  provenance: Record<string, unknown>
  horizon_hours: number
  resolves_at: string
}

type Preview = {
  row: Row
  tape_preflight: { source: string; price: number; ts: string }
  restamped_on_confirm: string[]
}

const usd = (n: number) => `${n < 0 ? '−' : '+'}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`

export function SignalPanel() {
  const [coins, setCoins] = useState<PulseCoin[]>([])
  const [live, setLive] = useState<boolean | null>(null)
  const [computedAt, setComputedAt] = useState<string | null>(null)

  const [coin, setCoin] = useState('')
  const [direction, setDirection] = useState<'up' | 'down'>('up')
  const [confidence, setConfidence] = useState('0.55')
  const [horizon, setHorizon] = useState('24')

  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [published, setPublished] = useState<{ id: number; resolves_at: string } | null>(null)

  useEffect(() => {
    fetch('/api/pulse', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        const list: PulseCoin[] = d.coins ?? []
        setCoins(list)
        setLive(Boolean(d.coverage?.live))
        setComputedAt(d.coverage?.computedAt ?? null)
        if (list.length) setCoin((c) => c || list[0].coin)
      })
      .catch(() => setError('Could not read /api/pulse.'))
  }, [])

  // Any edit invalidates the preview. Confirming a row built from inputs that
  // have since changed is exactly the mistake this screen exists to prevent.
  useEffect(() => { setPreview(null); setError(null) }, [coin, direction, confidence, horizon])

  const send = useCallback(async (confirm: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/cohort-signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coin,
          direction,
          confidence: Number(confidence),
          horizon_hours: Number(horizon),
          ...(confirm ? { confirm: true } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`)
        setPreview(null)
        return
      }
      if (confirm) {
        setPublished({ id: data.call.id, resolves_at: data.call.resolves_at })
        setPreview(null)
      } else {
        setPreview(data as Preview)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [coin, direction, confidence, horizon])

  const selected = coins.find((c) => c.coin === coin)
  const skewPct = selected && selected.notionalUsd > 0
    ? (selected.netFlowUsd / selected.notionalUsd) * 100
    : null

  if (published) {
    return (
      <div className="card p-4 space-y-2">
        <p className="text-xs font-semibold text-[#34EAB9]">Published as Ledger call #{published.id}</p>
        <p className="text-[11px] text-white/45 max-w-2xl">
          It cannot be edited or withdrawn. The scorer resolves it at{' '}
          <span className="font-mono">{published.resolves_at}</span> against captured tape; a missing
          print at either instant resolves it UNRESOLVABLE with no Brier score.
        </p>
        <a href={`/ledger/${published.id}`} target="_blank" rel="noreferrer"
           className="text-[11px] text-[#34EAB9] hover:underline">
          /ledger/{published.id}
        </a>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <div>
          <p className="text-xs font-semibold">Publish cohort signal</p>
          <p className="text-[11px] text-white/45 max-w-3xl mt-1">
            Which skew is worth calling is a judgement. This form takes the judgement and lets the
            service check it: the snapshot behind the call is fetched server-side from{' '}
            <code className="font-mono">/api/pulse</code> — the picker below is only a picker — and the
            call is built and written by{' '}
            <code className="font-mono">verify-service/lib/publish.mjs</code>, never a direct insert.
          </p>
          <p className="text-[10px] text-white/35 mt-1">
            {live === null ? 'Reading capture coverage…'
              : live
                ? `Capture live. Pulse matview computed ${computedAt ?? 'unknown'}.`
                : 'Capture is NOT live — the service will refuse to call off a stale snapshot.'}
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="text-[10px] text-white/40 block mb-1">Coin</span>
            <select
              value={coin}
              onChange={(e) => setCoin(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-[#34EAB9]/40"
            >
              {coins.length === 0 && <option value="">no coins in snapshot</option>}
              {coins.map((c) => (
                <option key={c.coin} value={c.coin}>{c.coin}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-[10px] text-white/40 block mb-1">Direction</span>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as 'up' | 'down')}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-[#34EAB9]/40"
            >
              <option value="up">up</option>
              <option value="down">down</option>
            </select>
          </label>

          <label className="block">
            <span className="text-[10px] text-white/40 block mb-1">Confidence (0–1)</span>
            <input
              value={confidence}
              onChange={(e) => setConfidence(e.target.value)}
              inputMode="decimal"
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-[#34EAB9]/40"
            />
          </label>

          <label className="block">
            <span className="text-[10px] text-white/40 block mb-1">Horizon (hours)</span>
            <input
              value={horizon}
              onChange={(e) => setHorizon(e.target.value)}
              inputMode="decimal"
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-[#34EAB9]/40"
            />
          </label>
        </div>

        {selected && (
          <p className="text-[10px] font-mono text-white/45">
            {selected.coin}: net flow {usd(selected.netFlowUsd)} on $
            {selected.notionalUsd.toLocaleString('en-US')} notional · {selected.activeWallets} wallets
            {skewPct !== null && <> · skew {skewPct.toFixed(1)}% {skewPct > 0 ? 'long' : 'short'}</>}
          </p>
        )}

        <button
          onClick={() => send(false)}
          disabled={busy || !coin}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/[0.06] text-white/70 hover:text-white/90 transition-colors disabled:opacity-40"
        >
          {busy ? 'Checking…' : 'Preview the call'}
        </button>

        {error && (
          <div className="border-l-2 border-l-[#FF3B5C] bg-[#FF3B5C]/[0.06] rounded p-3">
            <p className="text-[11px] text-[#FF3B5C] leading-relaxed">{error}</p>
          </div>
        )}
      </div>

      {preview && (
        <div className="card p-4 space-y-3 border-l-2 border-l-amber-400">
          <div className="flex items-start gap-2">
            <AlertTriangle size={12} className="text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-amber-400">
                Confirming writes this to a public, append-only table
              </p>
              <p className="text-[11px] text-white/45 mt-1 max-w-3xl">
                Every check has already passed on the server: the scorer&apos;s own{' '}
                <code className="font-mono">scoreableSubject()</code> read{' '}
                <span className="font-mono text-white/70">{preview.row.subject.coin}</span> /{' '}
                <span className="font-mono text-white/70">{preview.row.subject.direction}</span>, and
                the tape preflight found a {preview.tape_preflight.source} print at{' '}
                <span className="font-mono">{preview.tape_preflight.price}</span>. Confirm re-stamps{' '}
                {preview.restamped_on_confirm.map((f) => <code key={f} className="font-mono">{f} </code>)}
                to the moment you press it — a call is never backdated to when its preview rendered.
                Everything else below is final.
              </p>
            </div>
          </div>

          <pre className="bg-black/40 border border-white/[0.08] rounded-lg p-3 text-[10px] font-mono text-white/70 overflow-x-auto leading-relaxed">
{JSON.stringify(preview.row, null, 2)}
          </pre>

          <div className="flex gap-2">
            <button
              onClick={() => send(true)}
              disabled={busy}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-400/10 text-amber-400 hover:bg-amber-400/20 transition-colors disabled:opacity-40"
            >
              {busy ? 'Publishing…' : 'Confirm and publish'}
            </button>
            <button
              onClick={() => setPreview(null)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.04] text-white/55 hover:text-white/80 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
