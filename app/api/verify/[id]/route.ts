import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/db/supabase'

export const dynamic = 'force-dynamic'

const RESULTS_BUCKET = process.env.VERIFY_BUCKET || 'verification-results'
const CSV_URL_TTL_S = 60 * 60

/**
 * GET /api/verify/[id]
 * Job status, plus the result when the job is done.
 *
 * The result is returned whole — spec, metrics, verdict and data coverage
 * together — because reading any one of them without the others is how a
 * number gets quoted without its frictions or its coverage caveats attached.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'job id must be a positive integer' }, { status: 400 })
  }

  const supabase = getSupabase()

  const { data: job, error: jobError } = await supabase
    .from('verification_jobs')
    .select('id, spec, spec_hash, status, created_at, started_at, finished_at, error, requested_by, worker')
    .eq('id', id)
    .maybeSingle()

  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 })
  if (!job) return NextResponse.json({ error: `no verification job ${id}` }, { status: 404 })

  const response: Record<string, unknown> = {
    job_id: job.id,
    status: job.status,
    spec_hash: job.spec_hash,
    spec: job.spec,
    requested_by: job.requested_by,
    worker: job.worker,
    created_at: job.created_at,
    started_at: job.started_at,
    finished_at: job.finished_at,
    error: job.error,
    result: null,
  }

  if (job.status !== 'done') return NextResponse.json(response)

  // A job is only 'done' once its result row exists, so one row is expected.
  const { data: results, error: resultError } = await supabase
    .from('verification_results')
    .select('id, spec, spec_hash, trades_csv_path, trade_count, metrics, verdict, data_coverage, engine_version, created_at')
    .eq('job_id', id)
    .order('created_at', { ascending: false })
    .limit(1)

  if (resultError) return NextResponse.json({ error: resultError.message }, { status: 500 })

  const result = results?.[0]
  if (!result) {
    return NextResponse.json({ ...response, error: 'job is done but its result row is missing' }, { status: 500 })
  }

  let tradesCsvUrl: string | null = null
  if (result.trades_csv_path) {
    // trades_csv_path is stored bucket-qualified; the storage client wants the
    // object path within the bucket.
    const objectPath = result.trades_csv_path.replace(new RegExp(`^${RESULTS_BUCKET}/`), '')
    const { data: signed } = await supabase.storage
      .from(RESULTS_BUCKET)
      .createSignedUrl(objectPath, CSV_URL_TTL_S)
    tradesCsvUrl = signed?.signedUrl ?? null
  }

  return NextResponse.json({ ...response, result: { ...result, trades_csv_url: tradesCsvUrl } })
}
