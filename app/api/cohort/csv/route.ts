import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/db/supabase'
import { loadCohort, cohortCsv } from '@/lib/cohort'

// Request-time CSV snapshot of the capture-enabled cohort (address,
// archetype, added_at). Generated from the same paginated read and the same
// serialization as /cohort, so the SHA-256 displayed there is the hash of
// these bytes while the underlying data is unchanged.
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const wallets = await loadCohort(getSupabase())
    const csv = cohortCsv(wallets)
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="alphalens-cohort.csv"',
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    // Honest empty state: no fabricated snapshot when the database read fails.
    return new NextResponse('cohort snapshot unavailable', { status: 503 })
  }
}
