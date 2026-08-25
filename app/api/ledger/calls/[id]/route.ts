import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/db/supabase'
import type { LedgerCall } from '@/lib/ledger/calls'
import { CORS_HEADERS, ledgerJson, serializeCall } from '@/lib/ledger/api'

export const dynamic = 'force-dynamic'

/**
 * GET /api/ledger/calls/[id]
 * One Ledger call as machine-readable JSON — the API twin of the /ledger/[id]
 * permalink page. Read-only; documented at /docs/api. Queries directly rather
 * than via loadCall so a database outage reports 503, not a false 404.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return ledgerJson({ error: 'id must be a positive integer' }, 400)
  }
  try {
    const { data, error } = await getSupabase()
      .from('ledger_calls')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    if (!data) return ledgerJson({ error: 'call not found' }, 404)
    return ledgerJson({ call: serializeCall(data as LedgerCall) })
  } catch {
    return ledgerJson({ error: 'ledger temporarily unavailable' }, 503)
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}
