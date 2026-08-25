import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/db/supabase'
import type { LedgerCall } from '@/lib/ledger/calls'
import { CORS_HEADERS, decodeCursor, encodeCursor, ledgerJson, serializeCall } from '@/lib/ledger/api'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/**
 * GET /api/ledger/calls?limit=50&cursor=...
 * The public Ledger as machine-readable JSON: reverse-chronological calls,
 * keyset-paginated. Read-only; documented at /docs/api. Explicitly bounded —
 * PostgREST truncates silently near 1000 rows, so every page is a chosen cap.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams

  let limit = DEFAULT_LIMIT
  const rawLimit = params.get('limit')
  if (rawLimit !== null) {
    const n = Number(rawLimit)
    if (!Number.isInteger(n) || n < 1) {
      return ledgerJson({ error: `limit must be an integer between 1 and ${MAX_LIMIT}` }, 400)
    }
    limit = Math.min(n, MAX_LIMIT)
  }

  const rawCursor = params.get('cursor')
  const cursor = rawCursor !== null ? decodeCursor(rawCursor) : null
  if (rawCursor !== null && cursor === null) {
    return ledgerJson({ error: 'invalid cursor' }, 400)
  }

  try {
    let query = getSupabase()
      .from('ledger_calls')
      .select('*')
      .order('published_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1) // one extra row to detect whether a next page exists
    if (cursor) {
      query = query.or(
        `published_at.lt.${cursor.publishedAt},and(published_at.eq.${cursor.publishedAt},id.lt.${cursor.id})`
      )
    }
    const { data, error } = await query
    if (error) throw error

    const rows = (data || []) as LedgerCall[]
    const page = rows.slice(0, limit)
    const nextCursor = rows.length > limit && page.length > 0 ? encodeCursor(page[page.length - 1]) : null

    return ledgerJson({
      calls: page.map(serializeCall),
      next_cursor: nextCursor,
    })
  } catch {
    return ledgerJson({ error: 'ledger temporarily unavailable' }, 503)
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}
