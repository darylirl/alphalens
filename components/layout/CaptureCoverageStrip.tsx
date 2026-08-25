// Data coverage strip — real capture status, never fabricated. Extracted from
// /pulse so every public page that renders captured data shows the same
// honest provenance strip. Server component; all values come from
// capture_health rows the caller actually read.

function ago(ts: string | null): string {
  if (!ts) return '—'
  const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ${m % 60}m ago`
}

export function CaptureCoverageStrip({
  lastHeartbeat,
  walletsTracked,
  captureSince,
  refreshNote,
}: {
  lastHeartbeat: string | null
  walletsTracked: number | null
  captureSince: string | null
  refreshNote?: string
}) {
  const live = lastHeartbeat !== null && Date.now() - new Date(lastHeartbeat).getTime() < 3 * 60 * 1000
  const sinceLabel = captureSince
    ? new Date(captureSince).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : null

  return (
    <div className="card p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2 h-2 rounded-full ${live ? 'bg-[#34EAB9] animate-pulse' : 'bg-[#FF3B5C]'}`} />
        <span className="text-xs font-semibold">{live ? 'Capture running' : 'Capture offline'}</span>
        {refreshNote && <span className="text-[10px] text-white/40 ml-auto">{refreshNote}</span>}
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-[#0F1A1E] rounded p-2">
          <p className="text-[9px] text-white/40 mb-0.5">Capturing since</p>
          <p className="text-[11px] font-mono">{sinceLabel ?? '—'}</p>
        </div>
        <div className="bg-[#0F1A1E] rounded p-2">
          <p className="text-[9px] text-white/40 mb-0.5">Wallets tracked</p>
          <p className="text-[11px] font-mono">{walletsTracked?.toLocaleString() ?? '—'}</p>
        </div>
        <div className="bg-[#0F1A1E] rounded p-2">
          <p className="text-[9px] text-white/40 mb-0.5">Last heartbeat</p>
          <p className="text-[11px] font-mono">{ago(lastHeartbeat)}</p>
        </div>
      </div>
    </div>
  )
}

/** The capture_health reads behind the strip — shared by /pulse and /ledger. */
export async function loadCaptureStatus(supabase: {
  from: (t: string) => any
}): Promise<{ lastHeartbeat: string | null; walletsTracked: number | null; captureSince: string | null }> {
  try {
    const [{ data: latest }, { data: first }] = await Promise.all([
      supabase.from('capture_health').select('ts,wallets_polled').order('ts', { ascending: false }).limit(1),
      supabase.from('capture_health').select('ts').order('ts', { ascending: true }).limit(1),
    ])
    return {
      lastHeartbeat: latest?.[0]?.ts ?? null,
      walletsTracked: latest?.[0]?.wallets_polled ?? null,
      captureSince: first?.[0]?.ts ?? null,
    }
  } catch {
    return { lastHeartbeat: null, walletsTracked: null, captureSince: null }
  }
}
