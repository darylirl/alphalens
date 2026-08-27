'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { PublishStatus } from '@/lib/admin/publish-status'
import { StatusPill } from './EnqueuePanel'

const LIMIT = 25          // GET /api/verify caps at 100; this is a chosen page
const REFRESH_MS = 10_000

interface Job {
  id: number
  spec_hash: string | null
  status: string
  created_at: string | null
  started_at: string | null
  finished_at: string | null
  error: string | null
  requested_by: string | null
}

export function JobsPanel({ publishStatus }: { publishStatus: PublishStatus }) {
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/verify?limit=${LIMIT}`, { cache: 'no-store' })
      // A failing route can return an empty body, and a JSON parse error in
      // that case would report the parser instead of the fault. Say the status.
      const d = await res.json().catch(() => null)
      if (!res.ok) throw new Error(d?.error || `HTTP ${res.status}`)
      if (!d || !Array.isArray(d.jobs)) throw new Error(`HTTP ${res.status} with an unreadable body`)
      setJobs(d.jobs)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not load jobs')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, REFRESH_MS)
    return () => clearInterval(t)
  }, [load])

  // Result and Ledger-call links come from the publishing record loaded on the
  // server. A job older than that record's window simply has no link — shown
  // as "—", never as "not published", which would be a claim we cannot make.
  const byJob = useMemo(() => {
    const m = new Map<number, PublishStatus['rows'][number]>()
    for (const r of publishStatus.rows) if (r.job_id != null && !m.has(r.job_id)) m.set(r.job_id, r)
    return m
  }, [publishStatus])

  const oldestKnownJob = useMemo(() => {
    const ids = publishStatus.rows.map((r) => r.job_id).filter((j): j is number => j != null)
    return ids.length ? Math.min(...ids) : null
  }, [publishStatus])

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08]">
        <div>
          <p className="text-xs font-semibold">Verification jobs</p>
          <p className="text-[10px] text-white/35">
            The {LIMIT} most recent, newest first · refreshing every {REFRESH_MS / 1000}s
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-white/[0.04] text-white/55 hover:text-white/80 transition-colors disabled:opacity-40"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && <p className="px-4 py-3 text-[11px] text-[#FF3B5C]">Could not load jobs: {error}</p>}

      {jobs === null && !error ? (
        <p className="px-4 py-6 text-center text-xs text-white/40">Loading…</p>
      ) : jobs && jobs.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-white/40">No verification jobs have been enqueued.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-white/40 text-[10px] border-b border-white/[0.08]">
                <th className="text-left py-2.5 px-4 font-medium">Job</th>
                <th className="text-left py-2.5 px-2 font-medium">Status</th>
                <th className="text-left py-2.5 px-2 font-medium">Engine</th>
                <th className="text-left py-2.5 px-2 font-medium">Requested by</th>
                <th className="text-left py-2.5 px-2 font-medium">Created</th>
                <th className="text-left py-2.5 px-4 font-medium">Result / Ledger</th>
              </tr>
            </thead>
            <tbody>
              {(jobs || []).map((j) => {
                const pub = byJob.get(j.id)
                const beyondRecord = oldestKnownJob !== null && j.id < oldestKnownJob && !pub
                return (
                  <tr key={j.id} className="border-t border-white/[0.04] hover:bg-white/[0.02] transition-colors align-top">
                    <td className="py-2.5 px-4">
                      <p className="font-mono text-white/70">{j.id}</p>
                      <p className="font-mono text-[9px] text-white/30">
                        {j.spec_hash ? `${j.spec_hash.slice(0, 12)}…` : '—'}
                      </p>
                    </td>
                    <td className="py-2.5 px-2">
                      <StatusPill status={j.status} />
                      {j.error && <p className="text-[9px] text-[#FF3B5C] mt-1 max-w-[16rem] break-words">{j.error}</p>}
                    </td>
                    <td className="py-2.5 px-2 font-mono text-[10px] text-white/55">
                      {pub?.engine_version ?? (j.status === 'done' ? '—' : '')}
                    </td>
                    <td className="py-2.5 px-2 text-[10px] text-white/45 max-w-[12rem] truncate">
                      {j.requested_by || '—'}
                    </td>
                    <td className="py-2.5 px-2 text-[10px] text-white/40">
                      {j.created_at ? new Date(j.created_at).toLocaleString() : '—'}
                    </td>
                    <td className="py-2.5 px-4 text-[10px] space-y-0.5">
                      <a
                        href={`/api/verify/${j.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#34EAB9] hover:underline block"
                      >
                        result JSON
                      </a>
                      {pub?.call_id != null ? (
                        <a href={`/ledger/${pub.call_id}`} className="text-[#34EAB9] hover:underline block">
                          Ledger call {pub.call_id}
                        </a>
                      ) : pub ? (
                        <span className="text-white/30 block">not in the Ledger — see Ledger publishing</span>
                      ) : beyondRecord ? (
                        <span className="text-white/25 block">older than the loaded publishing record</span>
                      ) : (
                        <span className="text-white/25 block">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
