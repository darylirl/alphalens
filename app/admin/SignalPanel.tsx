'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Radio, RefreshCw, Send } from 'lucide-react'
// The floors are imported so the form cannot drift from the publisher. The
// browser check is a courtesy — /api/ledger/publish-signal enforces the same
// rules server-side through cohortSignalCall(), whatever this file believes.
import {
  SIGNAL_MIN_SKEW_PCT,
  SIGNAL_MIN_NOTIONAL_USD,
  SIGNAL_MIN_WALLETS,
  SIGNAL_MIN_PARTICIPATING_WALLETS,
  SIGNAL_MAX_WALLET_CONCENTRATION_PCT,
  concentrationFor,
} from '@/verify-service/lib/signal-floors.mjs'

interface Side { notionalUsd: number; wallets: number; topWalletNotionalUsd: number; topWalletSharePct: number | null }
interface Coin {
  coin: string
  notionalUsd: number
  netFlowUsd: number
  longPct: number
  longPctChange: number | null
  activeWallets: number
  concentration: { long: Side; short: Side } | null
}
interface Pulse {
  coins: Coin[]
  coverage: { live: boolean; computedAt: string | null; lastHeartbeat: string | null; walletsTracked: number | null }
}

const usd = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`

/** Every floor, evaluated for one coin in one direction. */
function assess(c: Coin, direction: 'up' | 'down', coverage: Pulse['coverage']) {
  const skewPct = c.notionalUsd > 0 ? (c.netFlowUsd / c.notionalUsd) * 100 : NaN
  const snapshotDirection = skewPct > 0 ? 'up' : 'down'
  const conc = concentrationFor({ ...c, coverage, computedAt: coverage.computedAt }, direction) as
    { measured: boolean; why?: string; wallets?: number; topWalletSharePct?: number; directionalNotionalUsd?: number }

  const checks: Array<{ label: string; ok: boolean; detail: string }> = [
    {
      label: 'Direction matches the snapshot',
      ok: direction === snapshotDirection,
      detail: `net flow ${usd(c.netFlowUsd)} is net ${c.netFlowUsd >= 0 ? 'long' : 'short'}`,
    },
    {
      label: `Skew ≥ ${SIGNAL_MIN_SKEW_PCT}%`,
      ok: Math.abs(skewPct) >= SIGNAL_MIN_SKEW_PCT,
      detail: `${skewPct.toFixed(2)}%`,
    },
    {
      label: `Notional ≥ ${usd(SIGNAL_MIN_NOTIONAL_USD)}`,
      ok: c.notionalUsd >= SIGNAL_MIN_NOTIONAL_USD,
      detail: usd(c.notionalUsd),
    },
    {
      label: `Active wallets ≥ ${SIGNAL_MIN_WALLETS}`,
      ok: c.activeWallets >= SIGNAL_MIN_WALLETS,
      detail: `${c.activeWallets}`,
    },
    {
      label: `Participating wallets ≥ ${SIGNAL_MIN_PARTICIPATING_WALLETS}`,
      ok: Boolean(conc.measured) && (conc.wallets ?? 0) >= SIGNAL_MIN_PARTICIPATING_WALLETS,
      detail: conc.measured ? `${conc.wallets} on the ${direction === 'up' ? 'long' : 'short'} side` : 'not measured',
    },
    {
      label: `Top wallet ≤ ${SIGNAL_MAX_WALLET_CONCENTRATION_PCT}% of directional notional`,
      ok: Boolean(conc.measured) && (conc.topWalletSharePct ?? 100) <= SIGNAL_MAX_WALLET_CONCENTRATION_PCT,
      detail: conc.measured
        ? `${(conc.topWalletSharePct ?? 0).toFixed(1)}% of ${usd(conc.directionalNotionalUsd ?? 0)}`
        : (conc.why ?? 'not measured'),
    },
    { label: 'Capture coverage live', ok: Boolean(coverage.live), detail: coverage.live ? 'live' : 'not live' },
  ]
  return { checks, skewPct, conc, clears: checks.every((k) => k.ok) }
}

export function SignalPanel() {
  const [pulse, setPulse] = useState<Pulse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [coin, setCoin] = useState('')
  const [direction, setDirection] = useState<'up' | 'down'>('down')
  const [confidence, setConfidence] = useState('0.55')
  const [horizon, setHorizon] = useState('24')
  const [preview, setPreview] = useState<{ row: Record<string, unknown>; telegram: { text: string; configured: boolean } } | null>(null)
  const [errors, setErrors] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [published, setPublished] = useState<{ id: number; permalink: string } | null>(null)

  const loadPulse = useCallback(async () => {
    setPreview(null); setErrors(null)
    try {
      const res = await fetch('/api/pulse', { cache: 'no-store' })
      const d = await res.json().catch(() => null)
      if (!res.ok || !d) throw new Error(`HTTP ${res.status}`)
      setPulse(d)
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'could not read /api/pulse')
    }
  }, [])

  useEffect(() => { loadPulse() }, [loadPulse])

  const selected = useMemo(() => pulse?.coins.find((c) => c.coin === coin) ?? null, [pulse, coin])
  const assessment = useMemo(
    () => (selected && pulse ? assess(selected, direction, pulse.coverage) : null),
    [selected, direction, pulse],
  )

  // Candidates clearing every floor in at least one direction — the shortlist
  // worth a human's judgement, not a recommendation of which to call.
  const clearing = useMemo(() => {
    if (!pulse) return []
    return pulse.coins.filter((c) =>
      (['up', 'down'] as const).some((d) => assess(c, d, pulse.coverage).clears))
  }, [pulse])

  const runPreview = async () => {
    setBusy(true); setErrors(null); setPreview(null)
    try {
      const res = await fetch('/api/ledger/publish-signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coin, direction,
          confidence: Number(confidence),
          horizon_hours: Number(horizon),
          snapshot: { ...selected, computedAt: pulse?.coverage.computedAt, coverage: pulse?.coverage },
        }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok || !d?.publishable) {
        setErrors(d?.errors ?? [d?.error || `HTTP ${res.status}`])
        return
      }
      setPreview(d.preview)
    } catch {
      setErrors(['Network error — nothing was published.'])
    } finally { setBusy(false) }
  }

  const publish = async () => {
    setBusy(true); setErrors(null)
    try {
      const res = await fetch('/api/ledger/publish-signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coin, direction,
          confidence: Number(confidence),
          horizon_hours: Number(horizon),
          snapshot: { ...selected, computedAt: pulse?.coverage.computedAt, coverage: pulse?.coverage },
          confirm: true,
        }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok || !d?.published) {
        setErrors(d?.reasons ?? [d?.error || `HTTP ${res.status}`])
        return
      }
      setPublished({ id: d.call.id, permalink: d.permalink })
      setPreview(null)
    } catch {
      setErrors(['Network error — the publish result is unknown. Check /ledger before retrying.'])
    } finally { setBusy(false) }
  }

  if (published) {
    return (
      <div className="card p-4 border-l-2 border-l-emerald-400 space-y-2">
        <p className="text-xs font-semibold text-emerald-400">Published as Ledger call {published.id}</p>
        <a href={published.permalink} className="text-[11px] text-[#34EAB9] hover:underline">{published.permalink}</a>
        <p className="text-[10px] text-white/40">
          Announced to the public channel. The scorer resolves it at its horizon against captured tape.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs font-semibold flex items-center gap-1.5"><Radio size={12} className="text-[#34EAB9]" /> Publish a cohort signal</p>
            <p className="text-[11px] text-white/45 max-w-2xl mt-1">
              A forward call, published before its evidence exists and settled later by the scorer.
              Which skew is worth calling is your judgement — this form checks that judgement against
              live data and records what it was based on. It does not pick for you.
            </p>
          </div>
          <button onClick={loadPulse} disabled={busy}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-white/[0.04] text-white/55 hover:text-white/80 transition-colors disabled:opacity-40">
            <RefreshCw size={12} /> Fresh snapshot
          </button>
        </div>
        <div className="card p-3 border-l-2 border-l-amber-400 flex items-start gap-2 !bg-amber-400/[0.03]">
          <AlertTriangle size={12} className="text-amber-400 mt-0.5 shrink-0" />
          <p className="text-[11px] text-amber-400">
            Publishing writes to an append-only table and broadcasts to the public Telegram channel.
            There is no edit and no undo. The exact row and the exact post are shown below before anything is sent.
          </p>
        </div>
        {pulse && (
          <p className="text-[10px] text-white/35">
            Snapshot computed {pulse.coverage.computedAt ? new Date(pulse.coverage.computedAt).toLocaleString() : '—'} ·
            capture {pulse.coverage.live ? 'live' : 'NOT live'} ·
            {' '}{clearing.length} of {pulse.coins.length} coins clear every floor in some direction
            {clearing.length > 0 ? `: ${clearing.map((c) => c.coin).join(', ')}` : ' — the Ledger waits'}
          </p>
        )}
        {loadError && <p className="text-[11px] text-[#FF3B5C]">Could not read /api/pulse: {loadError}</p>}
      </div>

      <div className="card p-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <label className="text-[10px] text-white/40 space-y-1">
            <span>Coin</span>
            <select value={coin} onChange={(e) => { setCoin(e.target.value); setPreview(null) }}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1.5 text-xs text-[#F0FAF8] focus:outline-none focus:border-[#34EAB9]/40">
              <option value="" className="bg-[#0F1A1E]">Select…</option>
              {(pulse?.coins ?? []).map((c) => (
                <option key={c.coin} value={c.coin} className="bg-[#0F1A1E]">{c.coin}</option>
              ))}
            </select>
          </label>
          <label className="text-[10px] text-white/40 space-y-1">
            <span>Direction</span>
            <select value={direction} onChange={(e) => { setDirection(e.target.value as 'up' | 'down'); setPreview(null) }}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1.5 text-xs text-[#F0FAF8] focus:outline-none focus:border-[#34EAB9]/40">
              <option value="down" className="bg-[#0F1A1E]">down</option>
              <option value="up" className="bg-[#0F1A1E]">up</option>
            </select>
          </label>
          <label className="text-[10px] text-white/40 space-y-1">
            <span>Confidence (0–1)</span>
            <input value={confidence} onChange={(e) => { setConfidence(e.target.value); setPreview(null) }}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1.5 text-xs font-mono text-[#F0FAF8] focus:outline-none focus:border-[#34EAB9]/40" />
          </label>
          <label className="text-[10px] text-white/40 space-y-1">
            <span>Horizon (hours)</span>
            <input value={horizon} onChange={(e) => { setHorizon(e.target.value); setPreview(null) }}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1.5 text-xs font-mono text-[#F0FAF8] focus:outline-none focus:border-[#34EAB9]/40" />
          </label>
        </div>

        {assessment && (
          <div className="space-y-1">
            <p className="text-[10px] text-white/40 uppercase tracking-wider">Pre-registered criteria</p>
            {assessment.checks.map((k) => (
              <div key={k.label} className="flex items-start gap-2 text-[11px]">
                {k.ok
                  ? <Check size={12} className="text-[#34EAB9] mt-0.5 shrink-0" />
                  : <AlertTriangle size={12} className="text-[#FF3B5C] mt-0.5 shrink-0" />}
                <span className={k.ok ? 'text-white/60' : 'text-[#FF3B5C]'}>
                  {k.label} — <span className="font-mono">{k.detail}</span>
                </span>
              </div>
            ))}
          </div>
        )}

        <button onClick={runPreview} disabled={!coin || busy || !assessment?.clears}
          className="px-4 py-2 rounded-lg text-xs font-semibold bg-white/[0.06] text-white/80 hover:bg-white/[0.1] transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
          {busy ? 'Checking…' : 'Preview the exact row and post'}
        </button>

        {errors && (
          <div className="text-[11px] text-[#FF3B5C] space-y-1">
            <p className="font-semibold">Refused:</p>
            <ul className="list-disc pl-6 space-y-0.5">
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}
      </div>

      {preview && (
        <div className="card p-4 space-y-3 border-l-2 border-l-[#34EAB9]">
          <p className="text-xs font-semibold">Exactly what will be written</p>
          <pre className="bg-[#0F1A1E] rounded-lg p-3 text-[10px] font-mono text-white/70 overflow-x-auto max-h-80">
{JSON.stringify(preview.row, null, 2)}
          </pre>
          <p className="text-xs font-semibold">
            Exactly what will be broadcast{preview.telegram.configured ? '' : ' (channel not configured — nothing will post)'}
          </p>
          <pre className="bg-[#0F1A1E] rounded-lg p-3 text-[10px] font-mono text-white/70 overflow-x-auto whitespace-pre-wrap">
{preview.telegram.text}
          </pre>
          <p className="text-[10px] text-white/35">
            The call id is the one value assigned at insert; everything else above is final.
          </p>
          <button onClick={publish} disabled={busy}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[#FF3B5C] text-white hover:bg-[#FF5C7A] transition-colors disabled:opacity-40">
            <Send size={12} /> {busy ? 'Publishing…' : 'Publish permanently'}
          </button>
        </div>
      )}
    </div>
  )
}
