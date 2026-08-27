import { getSupabase } from '@/lib/db/supabase'
// The eligibility rule is imported from the publisher itself, never restated
// here. A second copy of "what may reach the Ledger" that drifted from the one
// the runner enforces would make this page a confident liar about the record.
import { ledgerEligibility } from '@/verify-service/lib/publish.mjs'

/** How a verification result stands with respect to the Ledger. */
export type PublishState =
  | 'published'     // this result has its own hypothesis_verdict call
  | 'suppressed'    // eligible, but not published — dedup or no adjudicated verdict
  | 'ineligible'    // the publishing rule rejects it; it stays in the table, out of the Ledger
  | 'pending'       // eligible and unpublished with no suppressing reason found

export interface PublishStatusRow {
  result_id: number
  job_id: number | null
  spec_hash: string | null
  engine_version: string | null
  created_at: string | null
  trade_count: number | null
  verdict_overall: string | null
  hypothesis_text: string | null
  state: PublishState
  /** The Ledger call published FROM this result, when there is one. */
  call_id: number | null
  /** Why it is not in the Ledger. Empty when published. */
  reasons: string[]
}

export interface PublishStatus {
  rows: PublishStatusRow[]
  /** The read is bounded on purpose; this is the bound that was applied. */
  results_limit: number
  /** True when the ledger_calls read hit its page cap — declared, not inferred. */
  calls_truncated: boolean
  error: string | null
}

const RESULTS_LIMIT = 100
const CALLS_PAGE_SIZE = 1000 // under PostgREST's silent ~1000-row truncation cap
const CALLS_MAX = 5000

interface ResultRow {
  id: number
  job_id: number | null
  spec: Record<string, unknown> | null
  spec_hash: string | null
  trade_count: number | null
  metrics: Record<string, unknown> | null
  verdict: { overall?: string } | null
  engine_version: string | null
  created_at: string | null
}

interface CallRow {
  id: number
  provenance: { result_id?: unknown; spec_hash?: unknown } | null
}

/**
 * Every hypothesis_verdict call whose provenance names one of `values` under
 * `column`, explicitly paged until a short page comes back. PostgREST truncates
 * silently near 1000 rows — a single unbounded select here would under-report
 * published calls, which is exactly the direction that would make an already
 * published result look publishable again.
 */
async function pagedCalls(
  column: string,
  values: Array<string | number>,
): Promise<{ calls: CallRow[]; truncated: boolean }> {
  const calls: CallRow[] = []
  if (values.length === 0) return { calls, truncated: false }
  const inList = `(${values.join(',')})`
  const supabase = getSupabase()

  for (let offset = 0; offset < CALLS_MAX; offset += CALLS_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('ledger_calls')
      .select('id, provenance')
      .eq('kind', 'hypothesis_verdict')
      .filter(column, 'in', inList)
      .order('id', { ascending: true })
      .range(offset, offset + CALLS_PAGE_SIZE - 1)
    if (error) throw error
    const page = (data || []) as CallRow[]
    calls.push(...page)
    if (page.length < CALLS_PAGE_SIZE) return { calls, truncated: false }
  }
  return { calls, truncated: true }
}

/**
 * The Ledger publishing record for the most recent verification results:
 * which are eligible, which published, and which are held back and why.
 *
 * This reads `verification_results` and `ledger_calls` and reports on them. It
 * publishes nothing: publishing is the runner's and the scorer's job, through
 * the tested path in verify-service/lib/publish.mjs. A console that could push
 * a row into the Ledger by hand would be a second, untested writer to an
 * append-only table.
 */
export async function loadPublishStatus(): Promise<PublishStatus> {
  try {
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('verification_results')
      .select('id, job_id, spec, spec_hash, trade_count, metrics, verdict, engine_version, created_at')
      .order('id', { ascending: false })
      .limit(RESULTS_LIMIT)
    if (error) throw error

    const results = (data || []) as ResultRow[]
    if (results.length === 0) {
      return { rows: [], results_limit: RESULTS_LIMIT, calls_truncated: false, error: null }
    }

    const ids = results.map((r) => r.id)
    const hashes = Array.from(
      new Set(results.map((r) => r.spec_hash).filter((h): h is string => typeof h === 'string' && h.length > 0)),
    )

    const [byResult, byHash] = await Promise.all([
      pagedCalls('provenance->>result_id', ids),
      // spec_hashes are hex, so no PostgREST quoting hazard in the in-list.
      pagedCalls('provenance->>spec_hash', hashes),
    ])

    const callForResult = new Map<number, number>()
    for (const c of byResult.calls) {
      const rid = Number(c.provenance?.result_id)
      if (Number.isInteger(rid) && !callForResult.has(rid)) callForResult.set(rid, c.id)
    }
    // Earliest call per spec_hash — the one publishResult() dedups against.
    const firstCallForHash = new Map<string, number>()
    for (const c of byHash.calls) {
      const h = c.provenance?.spec_hash
      if (typeof h === 'string' && !firstCallForHash.has(h)) firstCallForHash.set(h, c.id)
    }

    const rows: PublishStatusRow[] = results.map((r) => {
      // Spread rather than hand-pick: the rule reads engine_version and spec
      // today, and a hand-picked pair would quietly stop matching it if that
      // changed. null → undefined only because the column is nullable.
      const { eligible, reasons } = ledgerEligibility(
        { ...r, engine_version: r.engine_version ?? undefined },
      ) as { eligible: boolean; reasons: string[] }
      const callId = callForResult.get(r.id) ?? null
      const overall = typeof r.verdict?.overall === 'string' ? r.verdict.overall : null
      const hypothesis = typeof r.spec?.hypothesis_text === 'string' ? r.spec.hypothesis_text : null

      const base = {
        result_id: r.id,
        job_id: r.job_id,
        spec_hash: r.spec_hash,
        engine_version: r.engine_version,
        created_at: r.created_at,
        trade_count: r.trade_count,
        verdict_overall: overall,
        hypothesis_text: hypothesis,
        call_id: callId,
      }

      if (callId !== null) return { ...base, state: 'published' as const, reasons: [] }
      if (!eligible) return { ...base, state: 'ineligible' as const, reasons }

      // Eligible but uncalled. Name the specific reason the publisher would
      // have given, rather than leaving a blank the reader has to guess at.
      const held: string[] = []
      const dedupCall = r.spec_hash ? firstCallForHash.get(r.spec_hash) : undefined
      if (dedupCall !== undefined) {
        held.push(
          `dedup by spec_hash: this spec is already published as Ledger call ${dedupCall}, `
          + 'and a re-run reproducing the same verdict is evidence, not news',
        )
      }
      if (overall !== 'pass' && overall !== 'killed') {
        held.push(`verdict.overall is ${JSON.stringify(overall)} — a verdict call needs an adjudicated pass or killed`)
      }
      if (held.length > 0) return { ...base, state: 'suppressed' as const, reasons: held }
      return {
        ...base,
        state: 'pending' as const,
        reasons: ['eligible and not yet published — the scorer sweep publishes recent eligible results'],
      }
    })

    return {
      rows,
      results_limit: RESULTS_LIMIT,
      calls_truncated: byResult.truncated || byHash.truncated,
      error: null,
    }
  } catch (e) {
    // An empty list and an unreadable table are different claims; say which.
    return {
      rows: [],
      results_limit: RESULTS_LIMIT,
      calls_truncated: false,
      error: e instanceof Error ? e.message : 'could not read the publishing record',
    }
  }
}
