import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/db/supabase'
// The validator is shared with the worker rather than reimplemented: two
// copies of a rule grammar drift, and the whole point of a spec_hash is that
// the thing enqueued is exactly the thing verified.
import { validateSpec, specHash, SpecError, SPEC_VERSION } from '@/verify-service/lib/spec.mjs'

export const dynamic = 'force-dynamic'

/**
 * POST /api/verify
 * Validate a strategy spec, enqueue it, return the job id.
 *
 * Validation happens here so a bad spec fails fast with a list of everything
 * wrong with it, rather than becoming a failed job the requester has to poll
 * for. The worker re-validates anyway — the queue is a table, and a result is
 * only worth what its spec was checked against.
 */
export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'request body must be JSON' }, { status: 400 })
  }

  const payload = body as { spec?: unknown; requested_by?: unknown } | null
  const rawSpec = payload && typeof payload === 'object' && 'spec' in payload ? payload.spec : payload

  let spec
  try {
    spec = validateSpec(rawSpec)
  } catch (e) {
    if (e instanceof SpecError) {
      return NextResponse.json(
        { error: 'spec rejected', spec_version_supported: SPEC_VERSION, errors: e.errors },
        { status: 400 },
      )
    }
    throw e
  }

  const hash = specHash(spec)
  const requestedBy = typeof payload?.requested_by === 'string' ? payload.requested_by.slice(0, 200) : 'api'

  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('verification_jobs')
    .insert({ spec, spec_hash: hash, requested_by: requestedBy })
    .select('id, spec_hash, status, created_at')
    .single()

  if (error) {
    return NextResponse.json({ error: `could not enqueue: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({
    job_id: data.id,
    spec_hash: data.spec_hash,
    status: data.status,
    created_at: data.created_at,
    poll: `/api/verify/${data.id}`,
  }, { status: 202 })
}

/**
 * GET /api/verify
 * The most recent jobs. Bounded explicitly: PostgREST truncates silently at
 * ~1000 rows, so every read in this codebase states its own limit.
 */
export async function GET(req: NextRequest) {
  const limitParam = parseInt(req.nextUrl.searchParams.get('limit') || '20', 10)
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 20

  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('verification_jobs')
    .select('id, spec_hash, status, created_at, started_at, finished_at, error, requested_by')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ jobs: data ?? [], limit })
}
