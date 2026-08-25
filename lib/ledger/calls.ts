import { getSupabase } from '@/lib/db/supabase'

// Read-side of the Ledger. This module reads ONLY ledger_calls — the table
// nothing can write to except the tested publishing rule (verify-service
// lib/publish.mjs) and the scoring worker, both enforced by the database's
// append-only trigger and column grants. The page never re-derives calls from
// verification_results, so an ineligible result (e.g. id=1, pre-grammar
// engine) cannot leak into anything user-facing here.

export interface LedgerCall {
  id: number
  published_at: string
  kind: 'hypothesis_verdict' | 'cohort_signal'
  subject: Record<string, unknown>
  claim: string
  confidence: number | null
  provenance: Record<string, unknown>
  horizon_hours: number
  resolves_at: string | null
  resolved_at: string | null
  outcome: 'correct' | 'incorrect' | 'unresolvable' | null
  scored_brier: number | null
  resolution_evidence: Record<string, unknown> | null
}

export const CALLS_PAGE_LIMIT = 100

/** Most recent calls, newest first. Explicitly bounded — PostgREST truncates
 * silently near 1000 rows, so the limit here is a chosen cap, not an accident. */
export async function loadCalls(limit = CALLS_PAGE_LIMIT): Promise<LedgerCall[]> {
  try {
    const { data } = await getSupabase()
      .from('ledger_calls')
      .select('*')
      .order('published_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit)
    return (data || []) as LedgerCall[]
  } catch {
    return []
  }
}

export async function loadCall(id: number): Promise<LedgerCall | null> {
  try {
    const { data } = await getSupabase()
      .from('ledger_calls')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    return (data as LedgerCall) || null
  } catch {
    return null
  }
}

/** Scored resolutions for the calibration curve: the most recent 1000 —
 * an intentional cap with a stable order, revisit if the ledger outgrows it. */
export async function loadScoredResolutions(): Promise<Array<{ confidence: number; outcome: string }>> {
  try {
    const { data } = await getSupabase()
      .from('ledger_calls')
      .select('confidence,outcome')
      .eq('kind', 'cohort_signal')
      .in('outcome', ['correct', 'incorrect'])
      .order('resolved_at', { ascending: false })
      .limit(1000)
    return ((data || []) as Array<{ confidence: number | null; outcome: string }>)
      .filter((r): r is { confidence: number; outcome: string } => r.confidence !== null)
  } catch {
    return []
  }
}

export type Badge = { label: string; tone: 'green' | 'red' | 'amber' | 'gray' }

/** The outcome badge for one call. A pending signal says when it resolves;
 * a verdict call is born final and shows the verdict itself. */
export function callBadge(call: LedgerCall): Badge {
  if (call.kind === 'hypothesis_verdict') {
    return call.subject?.verdict === 'pass'
      ? { label: 'SURVIVED', tone: 'green' }
      : { label: 'KILLED', tone: 'red' }
  }
  if (call.outcome === 'correct') return { label: 'CORRECT', tone: 'green' }
  if (call.outcome === 'incorrect') return { label: 'INCORRECT', tone: 'red' }
  if (call.outcome === 'unresolvable') return { label: 'DATA GAP', tone: 'gray' }
  return { label: 'PENDING', tone: 'amber' }
}

export const BADGE_CLASSES: Record<Badge['tone'], string> = {
  green: 'text-[#34EAB9] border-[#34EAB9]/50',
  red: 'text-[#FF3B5C] border-[#FF3B5C]/50',
  amber: 'text-[#F5A623] border-[#F5A623]/50',
  gray: 'text-white/50 border-white/25',
}

export interface CalibrationBin {
  loPct: number
  hiPct: number
  predictedMean: number
  observedRate: number
  count: number
}

export const CALIBRATION_MIN_RESOLVED = 10

/** Bucket scored resolutions into 20%-wide confidence bins. */
export function calibrationBins(rows: Array<{ confidence: number; outcome: string }>): CalibrationBin[] {
  const bins: CalibrationBin[] = []
  for (let lo = 0; lo < 100; lo += 20) {
    const inBin = rows.filter((r) => {
      const pct = r.confidence * 100
      return pct >= lo && (lo === 80 ? pct <= 100 : pct < lo + 20)
    })
    if (inBin.length === 0) continue
    bins.push({
      loPct: lo,
      hiPct: lo + 20,
      predictedMean: inBin.reduce((s, r) => s + r.confidence, 0) / inBin.length,
      observedRate: inBin.filter((r) => r.outcome === 'correct').length / inBin.length,
      count: inBin.length,
    })
  }
  return bins
}
