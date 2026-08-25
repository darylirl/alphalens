import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getSupabase } from '@/lib/db/supabase'
import { BottomNav } from '@/components/layout/BottomNav'
import { CaptureCoverageStrip, loadCaptureStatus } from '@/components/layout/CaptureCoverageStrip'
import { loadCall, callBadge, BADGE_CLASSES, type LedgerCall } from '@/lib/ledger/calls'

// Permalink for one Ledger call. Public, no login; the OG share image lives
// in opengraph-image.tsx beside this file.
export const dynamic = 'force-dynamic'

const fmt = (ts: string | null) => (ts ? `${new Date(ts).toISOString().slice(0, 16).replace('T', ' ')} UTC` : '—')

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const id = Number(params.id)
  const call = Number.isInteger(id) && id > 0 ? await loadCall(id) : null
  if (!call) return { title: 'Ledger call — AlphaLens' }
  const badge = callBadge(call)
  return {
    title: `${badge.label}: Ledger call #${call.id} — AlphaLens`,
    description: call.claim.slice(0, 200),
    openGraph: { title: `Ledger call #${call.id} — ${badge.label}`, description: call.claim.slice(0, 200) },
    twitter: { card: 'summary_large_image' },
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-[11px] py-1.5 border-b border-white/[0.06] last:border-0">
      <span className="text-white/40 w-28 shrink-0">{label}</span>
      <span className="text-white/75 font-mono break-all">{children}</span>
    </div>
  )
}

function ProvenanceRows({ call }: { call: LedgerCall }) {
  const p = call.provenance
  return (
    <>
      <Row label="Engine">{String(p.engine ?? '—')}</Row>
      {typeof p.spec_hash === 'string' && <Row label="Spec hash">{p.spec_hash}</Row>}
      {typeof p.result_id === 'number' && (
        <Row label="Result">
          verification_results id={p.result_id}
          {typeof p.job_id === 'number' && ` (job ${p.job_id})`}
        </Row>
      )}
      {typeof p.research === 'string' && (
        <Row label="Research">
          <Link href={p.research} className="text-[#34EAB9] hover:underline">{p.research}</Link>
        </Row>
      )}
      {typeof p.artifacts === 'string' && <Row label="Artifacts">{p.artifacts}</Row>}
    </>
  )
}

export default async function LedgerCallPage({ params }: { params: { id: string } }) {
  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) notFound()
  const call = await loadCall(id)
  if (!call) notFound()

  const supabase = getSupabase()
  const capture = await loadCaptureStatus(supabase)
  const badge = callBadge(call)

  return (
    <div className="pb-20 md:pb-8">
      <div className="px-4 py-4 lg:px-6 max-w-2xl mx-auto space-y-4">
        <Link href="/ledger" className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-[#34EAB9] transition-colors">
          <ArrowLeft size={12} /> The Ledger
        </Link>

        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className={`text-[10px] font-mono font-bold uppercase tracking-wider border rounded px-2 py-0.5 ${BADGE_CLASSES[badge.tone]}`}>
              {badge.label}
            </span>
            <span className="text-[10px] text-white/40">
              {call.kind === 'hypothesis_verdict' ? 'hypothesis verdict' : 'cohort signal'} · call #{call.id}
            </span>
          </div>
          <p className="text-sm text-white/90 leading-relaxed mb-3">{call.claim}</p>

          <Row label="Published">{fmt(call.published_at)}</Row>
          {call.confidence !== null && (
            <Row label="Confidence">{Math.round(call.confidence * 100)}% (stated at publication)</Row>
          )}
          <Row label="Horizon">{Number(call.horizon_hours).toLocaleString()} hours</Row>
          {call.resolves_at && <Row label="Resolves">{fmt(call.resolves_at)}</Row>}
          <ProvenanceRows call={call} />
        </div>

        {call.kind === 'cohort_signal' && (
          <div className="card p-4">
            <p className="text-xs font-semibold mb-2">Resolution</p>
            {call.resolved_at ? (
              <>
                <Row label="Resolved">{fmt(call.resolved_at)}</Row>
                <Row label="Outcome">{call.outcome}</Row>
                <Row label="Brier score">
                  {call.scored_brier === null
                    ? 'none — a data gap is never scored either way'
                    : Number(call.scored_brier).toFixed(4)}
                </Row>
                {call.resolution_evidence && (
                  <pre className="mt-2 text-[10px] text-white/50 bg-[#0F1A1E] rounded p-2 overflow-x-auto">
                    {JSON.stringify(call.resolution_evidence, null, 2)}
                  </pre>
                )}
              </>
            ) : (
              <p className="text-[11px] text-white/40">
                Unresolved. This call resolves at {fmt(call.resolves_at)} against
                captured tape — the first recorded print at or after the horizon.
                If capture has a gap there, it is marked unresolvable, never
                guessed.
              </p>
            )}
          </div>
        )}

        <CaptureCoverageStrip
          lastHeartbeat={capture.lastHeartbeat}
          walletsTracked={capture.walletsTracked}
          captureSince={capture.captureSince}
          refreshNote="calls resolve against captured fills/candles only"
        />

        <p className="text-[10px] text-white/30 text-center pb-2">
          Append-only record: this call can gain a resolution, but its claim,
          confidence and provenance can never be edited.{' '}
          <Link href="/ledger/methodology" className="text-white/45 hover:text-[#34EAB9] underline">
            Methodology
          </Link>
        </p>
      </div>

      <div className="md:hidden">
        <BottomNav />
      </div>
    </div>
  )
}
