import { NextResponse } from 'next/server'
import { listFamousReplays } from '@/lib/replay/famous'
import { CORS_HEADERS } from '@/lib/ledger/api'

// The Famous Replays manifest, served as JSON. The source of truth is the
// repo-committed content/famous-replays.json (reviewable in git); this route
// exists so the pre-build worker (verify-service/prebuild.mjs) and any API
// consumer warm and read exactly the entries the app ships — one manifest,
// no copy that can drift.

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(
    { schema: 'famous-replays.v1', entries: listFamousReplays() },
    { headers: CORS_HEADERS }
  )
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}
