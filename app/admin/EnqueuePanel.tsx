'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, Play } from 'lucide-react'
// The SAME validator the engine and the API run — grammar.mjs is the grammar
// module split out of spec.mjs precisely so it can be bundled here without
// node:crypto. A browser-side reimplementation would drift, and a spec that
// passed in the console but failed at the API would be worse than no check.
import { validateSpec, SpecError, SPEC_VERSION, FRICTION_FLOORS } from '@/verify-service/lib/grammar.mjs'
import type { CommittedSpecs } from '@/lib/admin/specs'

const PASTE = '__paste__'
const POLL_MS = 4000

interface JobView {
  job_id: number
  status: string
  spec_hash: string
  error: string | null
  created_at: string | null
  started_at: string | null
  finished_at: string | null
  worker: string | null
  result: { id: number; verdict?: { overall?: string }; trade_count?: number } | null
}

export function EnqueuePanel({ committedSpecs }: { committedSpecs: CommittedSpecs }) {
  const [choice, setChoice] = useState<string>(committedSpecs.specs[0]?.file ?? PASTE)
  const [text, setText] = useState<string>(committedSpecs.specs[0]?.json ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string[] | null>(null)
  const [job, setJob] = useState<JobView | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const pick = (file: string) => {
    setChoice(file)
    setSubmitError(null)
    if (file === PASTE) { setText(''); return }
    setText(committedSpecs.specs.find((s) => s.file === file)?.json ?? '')
  }

  // ── Client-side validation, live ────────────────────────────────────
  const validation = useMemo((): { ok: boolean; errors: string[]; coins?: string[] } => {
    if (!text.trim()) return { ok: false, errors: [] }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (e) {
      return { ok: false, errors: [`not valid JSON: ${e instanceof Error ? e.message : String(e)}`] }
    }
    try {
      const spec = validateSpec(parsed) as { universe: { coins: string[] } }
      return { ok: true, errors: [], coins: spec.universe.coins }
    } catch (e) {
      if (e instanceof SpecError) return { ok: false, errors: e.errors }
      return { ok: false, errors: [e instanceof Error ? e.message : String(e)] }
    }
  }, [text])

  // ── Live status of the job we just enqueued ─────────────────────────
  const poll = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/verify/${id}`, { cache: 'no-store' })
      if (!res.ok) return
      const d = await res.json()
      setJob({
        job_id: d.job_id,
        status: d.status,
        spec_hash: d.spec_hash,
        error: d.error ?? null,
        created_at: d.created_at ?? null,
        started_at: d.started_at ?? null,
        finished_at: d.finished_at ?? null,
        worker: d.worker ?? null,
        result: d.result ?? null,
      })
      if (d.status === 'done' || d.status === 'failed') {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      }
    } catch { /* transient; the next tick retries */ }
  }, [])

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const submit = async () => {
    if (!validation.ok) return
    setSubmitting(true)
    setSubmitError(null)
    setJob(null)
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The cookie carries the token; the browser attaches it. No header, no
        // token in JS, nothing pasted anywhere but the sign-in field.
        body: JSON.stringify({
          spec: JSON.parse(text),
          requested_by: choice === PASTE ? 'admin-console (pasted)' : `admin-console (${choice})`,
        }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) {
        setSubmitError(Array.isArray(d?.errors) ? d.errors : [d?.error || `HTTP ${res.status}`])
        return
      }
      setJob({
        job_id: d.job_id, status: d.status, spec_hash: d.spec_hash, error: null,
        created_at: d.created_at ?? null, started_at: null, finished_at: null, worker: null, result: null,
      })
      pollRef.current = setInterval(() => poll(d.job_id), POLL_MS)
      poll(d.job_id)
    } catch {
      setSubmitError(['Network error — the job was not enqueued.'])
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold">Spec</p>
          <p className="text-[10px] text-white/35">
            grammar v{SPEC_VERSION} · friction floors {FRICTION_FLOORS.delay_s}s delay,{' '}
            {FRICTION_FLOORS.slippage_bps}bps slippage, {FRICTION_FLOORS.taker_fee_pct}%/side
          </p>
        </div>

        <select
          value={choice}
          onChange={(e) => pick(e.target.value)}
          className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-[#F0FAF8] focus:outline-none focus:border-[#34EAB9]/40"
        >
          {committedSpecs.specs.map((s) => (
            <option key={s.file} value={s.file} className="bg-[#0F1A1E]">{s.file}</option>
          ))}
          <option value={PASTE} className="bg-[#0F1A1E]">Paste JSON…</option>
        </select>

        {committedSpecs.error ? (
          <p className="text-[10px] text-[#FF3B5C]">
            Could not read verify-service/specs ({committedSpecs.error}). Paste a spec instead.
          </p>
        ) : committedSpecs.specs.length === 0 ? (
          <p className="text-[10px] text-white/35">No specs are committed to verify-service/specs.</p>
        ) : choice !== PASTE ? (
          <p className="text-[10px] text-white/35">
            {committedSpecs.specs.find((s) => s.file === choice)?.hypothesis_text
              ?? 'This file declares no hypothesis_text.'}
          </p>
        ) : null}

        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setChoice(PASTE) }}
          rows={14}
          spellCheck={false}
          placeholder='{ "spec_version": 1, "hypothesis_text": "…", … }'
          className="w-full bg-[#0F1A1E] border border-white/[0.08] rounded-lg px-3 py-2 text-[11px] font-mono leading-relaxed text-[#F0FAF8] placeholder:text-white/20 focus:outline-none focus:border-[#34EAB9]/40"
        />

        {/* Validation, before anything is sent */}
        {text.trim() && (
          validation.ok ? (
            <p className="text-[11px] text-[#34EAB9] flex items-start gap-1.5">
              <Check size={12} className="mt-0.5 shrink-0" />
              Valid against grammar v{SPEC_VERSION}
              {validation.coins?.length ? ` · universe: ${validation.coins.join(', ')}` : ''}
            </p>
          ) : (
            <div className="text-[11px] text-[#FF3B5C] space-y-1">
              <p className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle size={12} className="shrink-0" />
                Rejected by grammar v{SPEC_VERSION} — {validation.errors.length} problem
                {validation.errors.length === 1 ? '' : 's'}
              </p>
              <ul className="list-disc pl-6 space-y-0.5">
                {validation.errors.map((err, i) => <li key={i} className="font-mono text-[10px]">{err}</li>)}
              </ul>
            </div>
          )
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={submit}
            disabled={!validation.ok || submitting}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[#34EAB9] text-[#0F1A1E] hover:bg-[#2DD4A8] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Play size={12} /> {submitting ? 'Enqueueing…' : 'Enqueue'}
          </button>
          <p className="text-[10px] text-white/35">
            POST /api/verify. The worker re-validates and re-hashes — this check only saves you the round trip.
          </p>
        </div>

        {submitError && (
          <div className="text-[11px] text-[#FF3B5C] space-y-1">
            <p className="font-semibold">The API rejected it:</p>
            <ul className="list-disc pl-6 space-y-0.5">
              {submitError.map((err, i) => <li key={i} className="font-mono text-[10px]">{err}</li>)}
            </ul>
          </div>
        )}
      </div>

      {job && <JobCard job={job} />}
    </div>
  )
}

const STATUS_STYLES: Record<string, string> = {
  queued: 'bg-white/[0.06] text-white/55 border-white/[0.08]',
  running: 'bg-[#34EAB9]/10 text-[#34EAB9] border-[#34EAB9]/20',
  done: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  failed: 'bg-[#FF3B5C]/10 text-[#FF3B5C] border-[#FF3B5C]/20',
}

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${STATUS_STYLES[status] || STATUS_STYLES.queued}`}>
      {status}
    </span>
  )
}

function JobCard({ job }: { job: JobView }) {
  const live = job.status === 'queued' || job.status === 'running'
  return (
    <div className="card p-4 border-l-2 border-l-[#34EAB9] space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold">Job {job.job_id}</p>
        <StatusPill status={job.status} />
        {live && <span className="text-[10px] text-white/35">polling every {POLL_MS / 1000}s…</span>}
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
        <Field label="spec_hash" value={job.spec_hash ? `${job.spec_hash.slice(0, 16)}…` : '—'} mono />
        <Field label="worker" value={job.worker ?? '—'} mono />
        <Field label="started" value={job.started_at ? new Date(job.started_at).toLocaleTimeString() : '—'} />
        <Field label="finished" value={job.finished_at ? new Date(job.finished_at).toLocaleTimeString() : '—'} />
      </dl>
      {job.error && <p className="text-[11px] text-[#FF3B5C] font-mono">{job.error}</p>}
      {job.result && (
        <p className="text-[11px] text-white/70">
          Result {job.result.id}: verdict{' '}
          <span className="font-semibold">{job.result.verdict?.overall ?? 'unadjudicated'}</span>
          {typeof job.result.trade_count === 'number' ? ` over ${job.result.trade_count} trades` : ''} ·{' '}
          <a href={`/api/verify/${job.job_id}`} target="_blank" rel="noreferrer" className="text-[#34EAB9] hover:underline">
            full result JSON
          </a>
        </p>
      )}
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-[#0F1A1E] rounded p-2">
      <dt className="text-white/35 mb-0.5">{label}</dt>
      <dd className={`text-white/70 ${mono ? 'font-mono' : ''} truncate`}>{value}</dd>
    </div>
  )
}
