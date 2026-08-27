'use client'
import { useState } from 'react'
import { Activity, AlertTriangle, CheckCircle2, HelpCircle, Send } from 'lucide-react'

/**
 * Run the external dead-man's monitor on demand and show what it said.
 *
 * The monitor runs itself every 15 minutes on a Vercel cron, so this button is
 * not how it operates — it is how you check that it still works, and how you
 * hear it bark without waiting for something to actually die. The privileged
 * call happens server-side in /api/admin/monitor-check; no secret reaches the
 * browser.
 */

interface Stream {
  stream: string
  label: string
  status: 'ok' | 'stale' | 'unknown'
  lastSeenAt: string | null
  silentFor: number | null
  thresholdMs: number
  source: string
  readError: string | null
  incidentOpenedAt: string | null
}

interface Notification {
  stream: string
  kind: 'alert' | 'reminder' | 'recovery'
  delivered: boolean
  messageId?: number
  error?: string
}

interface MonitorResult {
  checkedAt: string
  healthy: boolean
  streams: Stream[]
  notifications: Notification[]
  state: {
    backend: string
    dedupBlindSpot: string | null
    openIncidents: string[]
    readError: string | null
    writeError: string | null
  }
  telegram: string
}

interface RunResponse {
  ok: boolean
  status: number
  durationMs: number
  result?: MonitorResult
  error?: string
  bodyPreview?: string
}

function duration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`
}

const STATUS_STYLE: Record<Stream['status'], string> = {
  ok: 'bg-[#34EAB9]/10 text-[#34EAB9] border-[#34EAB9]/20',
  stale: 'bg-[#FF3B5C]/10 text-[#FF3B5C] border-[#FF3B5C]/25',
  // "unknown" is not a middle ground between healthy and dead — it means the
  // check could not be made. Amber, and never quietly grouped with ok.
  unknown: 'bg-amber-400/10 text-amber-400 border-amber-400/25',
}

const STATUS_ICON = {
  ok: CheckCircle2,
  stale: AlertTriangle,
  unknown: HelpCircle,
} as const

export function MonitorPanel() {
  const [run, setRun] = useState<RunResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showRaw, setShowRaw] = useState(false)

  const check = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/monitor-check', { method: 'POST', cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (!data) throw new Error(`HTTP ${res.status} with an unreadable body`)
      setRun(data)
      if (!res.ok && data.error) setError(data.error)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not reach the monitor')
      setRun(null)
    } finally {
      setBusy(false)
    }
  }

  const result = run?.result ?? null

  return (
    <div className="space-y-3">
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-white/[0.08]">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold">External dead-man&apos;s monitor</p>
            <p className="text-[10px] text-white/35 mt-0.5">
              Runs on its own every 15 minutes via Vercel cron. This button invokes the same
              route the cron does, server-side with the cron secret — so a run here is the real
              path, alerts included, not a rehearsal of it.
            </p>
          </div>
          <button
            onClick={check}
            disabled={busy}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#34EAB9] text-[#0F1A1E] hover:bg-[#34EAB9]/85 transition-colors disabled:opacity-40 whitespace-nowrap"
          >
            <Activity size={12} className={busy ? 'animate-pulse' : ''} />
            {busy ? 'Checking…' : 'Run monitor check'}
          </button>
        </div>

        {error && (
          <div className="px-4 py-3 border-b border-white/[0.08] flex items-start gap-2">
            <AlertTriangle size={12} className="text-[#FF3B5C] mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-[11px] text-[#FF3B5C]">{error}</p>
              {run?.bodyPreview && (
                <pre className="text-[9px] text-white/30 mt-1 overflow-x-auto">{run.bodyPreview}</pre>
              )}
            </div>
          </div>
        )}

        {!run && !error && (
          <p className="px-4 py-6 text-center text-[11px] text-white/35">
            Not run yet in this session. Nothing is shown until there is a real result to show.
          </p>
        )}

        {result && (
          <div className="px-4 py-3 space-y-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-white/45">
              <span className={result.healthy ? 'text-[#34EAB9] font-semibold' : 'text-[#FF3B5C] font-semibold'}>
                {result.healthy ? 'All streams healthy' : 'Attention needed'}
              </span>
              <span>checked {new Date(result.checkedAt).toLocaleTimeString()}</span>
              <span>HTTP {run?.status} in {run?.durationMs}ms</span>
              <span>
                telegram:{' '}
                <span className={result.telegram === 'configured' ? 'text-white/70' : 'text-amber-400'}>
                  {result.telegram}
                </span>
              </span>
              <span>state store: <span className="text-white/70">{result.state.backend}</span></span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-[10px] min-w-[560px]">
                <thead className="text-white/35">
                  <tr className="text-left">
                    <th className="font-medium py-1 pr-3">Stream</th>
                    <th className="font-medium py-1 pr-3">Status</th>
                    <th className="font-medium py-1 pr-3">Silent for</th>
                    <th className="font-medium py-1 pr-3">Threshold</th>
                    <th className="font-medium py-1 pr-3">Last seen</th>
                    <th className="font-medium py-1">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {result.streams.map((s) => {
                    const Icon = STATUS_ICON[s.status]
                    return (
                      <tr key={s.stream} className="border-t border-white/[0.06]">
                        <td className="py-1.5 pr-3 font-medium whitespace-nowrap">{s.label}</td>
                        <td className="py-1.5 pr-3">
                          <span className={`inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded border ${STATUS_STYLE[s.status]}`}>
                            <Icon size={9} /> {s.status}
                          </span>
                        </td>
                        {/* An unmeasurable stream shows an em dash, never a zero:
                            "0s silent" would read as perfect health. */}
                        <td className="py-1.5 pr-3 text-white/60">{duration(s.silentFor)}</td>
                        <td className="py-1.5 pr-3 text-white/40">{duration(s.thresholdMs)}</td>
                        <td className="py-1.5 pr-3 text-white/40 font-mono whitespace-nowrap">
                          {s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleTimeString() : '—'}
                        </td>
                        <td className="py-1.5 text-white/30 font-mono">{s.readError ?? s.source}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="border-t border-white/[0.06] pt-2">
              <p className="text-[10px] font-semibold text-white/55 mb-1 flex items-center gap-1.5">
                <Send size={10} /> Telegram messages sent by this run
              </p>
              {result.notifications.length === 0 ? (
                <p className="text-[10px] text-white/35">
                  None. An incident already open stays quiet until it recovers or the 6-hour
                  reminder falls due — that silence is the dedup working, not a failure.
                </p>
              ) : (
                <ul className="space-y-1">
                  {result.notifications.map((n, i) => (
                    <li key={i} className="text-[10px] flex flex-wrap items-center gap-2">
                      <span className={`font-semibold ${n.kind === 'recovery' ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                        {n.kind}
                      </span>
                      <span className="text-white/60">{n.stream}</span>
                      {n.delivered ? (
                        <span className="text-[#34EAB9]">delivered{n.messageId ? ` · message_id ${n.messageId}` : ''}</span>
                      ) : (
                        <span className="text-[#FF3B5C]">not delivered — {n.error}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {(result.state.readError || result.state.writeError || result.state.openIncidents.length > 0) && (
              <div className="border-t border-white/[0.06] pt-2 text-[10px] space-y-0.5">
                {result.state.openIncidents.length > 0 && (
                  <p className="text-white/45">
                    Open incidents: <span className="text-white/70">{result.state.openIncidents.join(', ')}</span>
                  </p>
                )}
                {result.state.readError && (
                  <p className="text-amber-400">state read failed: {result.state.readError}</p>
                )}
                {result.state.writeError && (
                  <p className="text-amber-400">
                    state write failed: {result.state.writeError} — without a writable store the
                    monitor cannot dedup, so it will re-alert every run.
                  </p>
                )}
              </div>
            )}

            <button
              onClick={() => setShowRaw((v) => !v)}
              className="text-[10px] text-white/35 hover:text-white/60 transition-colors"
            >
              {showRaw ? 'Hide' : 'Show'} raw JSON
            </button>
            {showRaw && (
              <pre className="text-[9px] text-white/45 bg-black/30 rounded-lg p-3 overflow-x-auto">
                {JSON.stringify(run, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
