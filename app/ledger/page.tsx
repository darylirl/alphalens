import type { Metadata } from 'next'
import Link from 'next/link'
import { getSupabase } from '@/lib/db/supabase'
import { BottomNav } from '@/components/layout/BottomNav'
import { CaptureCoverageStrip, loadCaptureStatus } from '@/components/layout/CaptureCoverageStrip'
import {
  loadCalls, loadScoredResolutions, callBadge, BADGE_CLASSES,
  calibrationBins, CALIBRATION_MIN_RESOLVED, CALLS_PAGE_LIMIT,
} from '@/lib/ledger/calls'
import { CalibrationCurve } from '@/components/ledger/CalibrationCurve'

// The Ledger: public, append-only, scored calls. Server-rendered per request
// (build must not depend on the database); everything shown comes from
// ledger_calls, which only the tested publishing rule and the scoring worker
// can write. No login, no per-wallet anything.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'The Ledger — AlphaLens',
  description:
    'Every call AlphaLens publishes, timestamped and scored against captured tape. Append-only: wrong calls stay on the record.',
  openGraph: {
    title: 'The Ledger — AlphaLens',
    description:
      'Public, append-only, scored calls. Verdicts from frictioned replays, forward calls resolved against captured tape.',
  },
}

const dateLabel = (ts: string) =>
  new Date(ts).toISOString().slice(0, 10)

// Display-only annotation for verdicts sharing a spec_hash (e.g. the same
// spec re-run on separate infrastructure before publish dedup existed, calls
// 2 and 5). Both rows stay listed with their permalinks — the table is
// append-only and a reproduction is honest history — the later one is just
// labeled as reproducing the first.
function firstCallBySpecHash(calls: { id: number; kind: string; provenance: Record<string, unknown> }[]) {
  const first = new Map<string, number>()
  for (const c of [...calls].sort((a, b) => a.id - b.id)) {
    const hash = c.kind === 'hypothesis_verdict' ? c.provenance?.spec_hash : null
    if (typeof hash === 'string' && !first.has(hash)) first.set(hash, c.id)
  }
  return first
}

export default async function LedgerPage() {
  const supabase = getSupabase()
  const [calls, scored, capture] = await Promise.all([
    loadCalls(),
    loadScoredResolutions(),
    loadCaptureStatus(supabase),
  ])
  const firstBySpec = firstCallBySpecHash(calls)

  return (
    <div className="pb-20 md:pb-8">
      <div className="px-4 py-4 lg:px-6 max-w-2xl mx-auto space-y-4">
        <div>
          <h1 className="text-lg font-bold mb-1">The Ledger</h1>
          <p className="text-white/55 text-xs">
            Every call we publish, timestamped and scored against captured
            tape. Append-only by database enforcement: a wrong call is never
            edited or deleted — being seen to be wrong is the point.{' '}
            <Link href="/ledger/methodology" className="text-[#34EAB9] hover:underline">
              Methodology
            </Link>
          </p>
        </div>

        {/* Data coverage strip — same real capture status as /pulse */}
        <CaptureCoverageStrip
          lastHeartbeat={capture.lastHeartbeat}
          walletsTracked={capture.walletsTracked}
          captureSince={capture.captureSince}
          refreshNote="calls resolve against captured fills/candles only"
        />

        {/* Calibration — only once there is enough resolved record to mean anything */}
        <div className="card p-3">
          <p className="text-xs font-semibold mb-1">Calibration</p>
          {scored.length >= CALIBRATION_MIN_RESOLVED ? (
            <CalibrationCurve bins={calibrationBins(scored)} total={scored.length} />
          ) : (
            <p className="text-[11px] text-white/40">
              Calibration appears after 10 resolved calls.
              {scored.length > 0
                ? ` ${scored.length} resolved so far.`
                : ' No probabilistic calls have resolved yet.'}
            </p>
          )}
        </div>

        {/* Calls, newest first */}
        {calls.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-sm font-semibold mb-1">No calls yet</p>
            <p className="text-white/40 text-xs">
              Calls appear here the moment they are published — never
              backdated, never removed.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {calls.map((call) => {
              const badge = callBadge(call)
              const specHash = call.kind === 'hypothesis_verdict' ? call.provenance?.spec_hash : null
              const reproOf = typeof specHash === 'string' && firstBySpec.get(specHash) !== call.id
                ? firstBySpec.get(specHash)
                : null
              return (
                <Link key={call.id} href={`/ledger/${call.id}`} className="card p-3 block hover:border-white/20 transition-colors">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`text-[9px] font-mono font-bold uppercase tracking-wider border rounded px-1.5 py-0.5 ${BADGE_CLASSES[badge.tone]}`}>
                      {badge.label}
                    </span>
                    <span className="text-[10px] text-white/40">
                      {call.kind === 'hypothesis_verdict' ? 'hypothesis verdict' : 'cohort signal'}
                    </span>
                    {reproOf !== null && (
                      <span className="text-[9px] font-mono text-white/40 border border-white/[0.12] rounded px-1.5 py-0.5">
                        reproduces #{reproOf}
                      </span>
                    )}
                    <span className="text-[10px] text-white/40 font-mono ml-auto">
                      #{call.id} · {dateLabel(call.published_at)}
                    </span>
                  </div>
                  <p className="text-xs text-white/80 leading-relaxed">{call.claim}</p>
                  <div className="flex items-center gap-3 mt-1.5 text-[10px] text-white/40">
                    {call.confidence !== null && <span>confidence {Math.round(call.confidence * 100)}%</span>}
                    {call.kind === 'cohort_signal' && call.resolves_at && !call.resolved_at && (
                      <span>resolves {dateLabel(call.resolves_at)}</span>
                    )}
                    {call.scored_brier !== null && <span>Brier {Number(call.scored_brier).toFixed(3)}</span>}
                    <span className="font-mono truncate">{String(call.provenance?.engine ?? '')}</span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}

        <p className="text-[10px] text-white/30 text-center pb-2">
          Showing the most recent {Math.min(calls.length, CALLS_PAGE_LIMIT)} calls.
          Verdicts come from frictioned replays of captured data; forward calls
          resolve against captured tape and are never scored across data gaps.
          Nothing here is a recommendation.
        </p>
      </div>

      <div className="md:hidden">
        <BottomNav />
      </div>
    </div>
  )
}
