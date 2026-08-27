'use client'
import { useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { PublishState, PublishStatus } from '@/lib/admin/publish-status'

const STATE_META: Record<PublishState, { label: string; pill: string; blurb: string }> = {
  published: {
    label: 'Published',
    pill: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    blurb: 'A hypothesis_verdict call exists in the Ledger for this result.',
  },
  suppressed: {
    label: 'Suppressed',
    pill: 'bg-amber-400/10 text-amber-400 border-amber-400/20',
    blurb: 'Eligible, but held back — dedup by spec_hash, or no adjudicated verdict.',
  },
  ineligible: {
    label: 'Ineligible',
    pill: 'bg-white/[0.06] text-white/45 border-white/[0.08]',
    blurb: 'The publishing rule rejects it. The row stays in the table; it never reaches the Ledger.',
  },
  pending: {
    label: 'Pending',
    pill: 'bg-[#34EAB9]/10 text-[#34EAB9] border-[#34EAB9]/20',
    blurb: 'Eligible and uncalled with no suppressing reason — the scorer sweep should pick it up.',
  },
}

const ORDER: PublishState[] = ['published', 'suppressed', 'pending', 'ineligible']

export function PublishPanel({ publishStatus }: { publishStatus: PublishStatus }) {
  const [filter, setFilter] = useState<PublishState | null>(null)

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const r of publishStatus.rows) c[r.state] = (c[r.state] || 0) + 1
    return c
  }, [publishStatus])

  const rows = filter ? publishStatus.rows.filter((r) => r.state === filter) : publishStatus.rows

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-2">
        <p className="text-xs font-semibold">Ledger publishing</p>
        <p className="text-[11px] text-white/45 max-w-3xl">
          This page reports the record; it never writes to it. Publishing is the runner&apos;s and the
          scorer&apos;s job, through the one tested path in <code className="font-mono">verify-service/lib/publish.mjs</code>
          {' '}— eligibility below is computed by importing that module, not by restating its rule.
        </p>
        <p className="text-[10px] text-white/35">
          Scope: the {publishStatus.results_limit} most recent rows of{' '}
          <code className="font-mono">verification_results</code>, newest first. Older results are not
          shown and nothing here should be read as a claim about them.
        </p>
      </div>

      {publishStatus.error && (
        <div className="card p-3 border-l-2 border-l-[#FF3B5C] flex items-start gap-2">
          <AlertTriangle size={12} className="text-[#FF3B5C] mt-0.5 shrink-0" />
          <p className="text-[11px] text-[#FF3B5C]">
            The publishing record could not be read ({publishStatus.error}). The list below is empty
            because the query failed — not because there is nothing to show.
          </p>
        </div>
      )}

      {publishStatus.calls_truncated && (
        <div className="card p-3 border-l-2 border-l-amber-400 flex items-start gap-2">
          <AlertTriangle size={12} className="text-amber-400 mt-0.5 shrink-0" />
          <p className="text-[11px] text-amber-400">
            The <code className="font-mono">ledger_calls</code> read hit its page cap, so some calls
            may be missing from this view. Treat &ldquo;not published&rdquo; below as unconfirmed until the cap
            is raised.
          </p>
        </div>
      )}

      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        <button
          onClick={() => setFilter(null)}
          className={`whitespace-nowrap text-[10px] font-medium px-2.5 py-1 rounded-full transition-colors ${
            !filter ? 'bg-[#34EAB9] text-[#0F1A1E]' : 'bg-[#0F1A1E] text-white/55 hover:text-white/80'
          }`}
        >
          All {publishStatus.rows.length}
        </button>
        {ORDER.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(filter === s ? null : s)}
            className={`whitespace-nowrap text-[10px] font-medium px-2.5 py-1 rounded-full transition-colors ${
              filter === s ? 'bg-[#34EAB9] text-[#0F1A1E]' : 'bg-[#0F1A1E] text-white/55 hover:text-white/80'
            }`}
          >
            {STATE_META[s].label} {counts[s] || 0}
          </button>
        ))}
      </div>

      {filter && <p className="text-[10px] text-white/35">{STATE_META[filter].blurb}</p>}

      {publishStatus.rows.length === 0 && !publishStatus.error ? (
        <div className="card p-6 text-center text-xs text-white/40">
          No verification results have been written yet.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.result_id} className="card p-3 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${STATE_META[r.state].pill}`}>
                  {STATE_META[r.state].label}
                </span>
                <span className="text-[11px] font-mono text-white/70">result {r.result_id}</span>
                {r.job_id != null && <span className="text-[10px] text-white/35">job {r.job_id}</span>}
                {r.verdict_overall && (
                  <span className="text-[10px] text-white/45">verdict {r.verdict_overall}</span>
                )}
                {typeof r.trade_count === 'number' && (
                  <span className="text-[10px] text-white/35">{r.trade_count} trades</span>
                )}
                {r.call_id != null && (
                  <a href={`/ledger/${r.call_id}`} className="text-[10px] text-[#34EAB9] hover:underline">
                    Ledger call {r.call_id}
                  </a>
                )}
              </div>

              {r.hypothesis_text && (
                <p className="text-[11px] text-white/55 line-clamp-2">{r.hypothesis_text}</p>
              )}

              <p className="text-[9px] font-mono text-white/25">
                {r.engine_version || 'engine unrecorded'}
                {r.spec_hash ? ` · ${r.spec_hash.slice(0, 16)}…` : ''}
                {r.created_at ? ` · ${new Date(r.created_at).toLocaleString()}` : ''}
              </p>

              {r.reasons.length > 0 && (
                <ul className="list-disc pl-5 space-y-0.5">
                  {r.reasons.map((reason, i) => (
                    <li key={i} className="text-[10px] text-white/45">{reason}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
