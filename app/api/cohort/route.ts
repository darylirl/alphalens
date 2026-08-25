import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/db/supabase'
import { CORS_HEADERS, APP_URL, schemaJson } from '@/lib/ledger/api'
import { loadCohort, cohortCsv, sha256Hex, COHORT_SCHEMA, type CohortWallet } from '@/lib/cohort'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

const REPO = 'https://github.com/darylirl/alphalens'

// Why a wallet is in capture scope, in the same words as /cohort. Kept here
// as data rather than prose so an agent reading this endpoint inherits the
// selection criteria instead of having to scrape the page for them.
const SELECTION_CRITERIA = [
  'Classified by observed behavior — hold times, two-sided share, trade rate, position sizes — from public Hyperliquid fill and position data. No self-reporting, no submissions.',
  'Market-maker wallets are excluded from capture as of 2026-08-25: their two-sided inventory churn is market-neutral noise, not directional signal, and it dominated both disk growth and the /pulse skews.',
  'A handful of wallets are in scope because an active signal or a verification job references them, independent of behavioral classification.',
]

/**
 * GET /api/cohort?limit=100&cursor=0x...
 * The tracked cohort as machine-readable JSON — the API twin of /cohort.
 * Counts and the CSV hash describe the WHOLE cohort (loadCohort pages through
 * the table; PostgREST truncates silently near 1000 rows), while `wallets` is
 * one explicitly bounded page of it. Read-only; documented at /docs/api.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams

  let limit = DEFAULT_LIMIT
  const rawLimit = params.get('limit')
  if (rawLimit !== null) {
    const n = Number(rawLimit)
    if (!Number.isInteger(n) || n < 1) {
      return schemaJson(COHORT_SCHEMA, { error: `limit must be an integer between 1 and ${MAX_LIMIT}` }, 400)
    }
    limit = Math.min(n, MAX_LIMIT)
  }

  // Keyset cursor over the address ordering loadCohort already imposes. Plain
  // rather than opaque: an address is what the caller sees in the rows anyway,
  // and it makes a resumed page trivially checkable against the CSV.
  const cursor = params.get('cursor')
  if (cursor !== null && !/^0x[0-9a-fA-F]{40}$/.test(cursor)) {
    return schemaJson(COHORT_SCHEMA, { error: 'cursor must be a 0x-prefixed 40-hex-digit address' }, 400)
  }

  let wallets: CohortWallet[]
  try {
    wallets = await loadCohort(getSupabase())
  } catch {
    // Honest empty state: no fabricated or cached cohort when the read fails.
    // 503 and not an empty list — "we could not measure" is not "nobody is in
    // scope", and a machine must be able to tell those two apart.
    return schemaJson(COHORT_SCHEMA, { error: 'cohort snapshot unavailable' }, 503)
  }

  const byArchetype = new Map<string, number>()
  for (const w of wallets) {
    const key = w.archetype ?? 'unclassified'
    byArchetype.set(key, (byArchetype.get(key) ?? 0) + 1)
  }

  const after = cursor ? wallets.findIndex(w => w.address.toLowerCase() === cursor.toLowerCase()) : -1
  if (cursor && after === -1) {
    return schemaJson(COHORT_SCHEMA, { error: 'cursor address is not in the current cohort' }, 400)
  }
  const page = wallets.slice(after + 1, after + 1 + limit)
  const consumed = after + 1 + page.length
  const nextCursor = consumed < wallets.length && page.length > 0 ? page[page.length - 1].address : null

  return schemaJson(COHORT_SCHEMA, {
    count: wallets.length,
    by_archetype: [...byArchetype.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([archetype, count]) => ({ archetype, count })),
    selection: {
      criteria: SELECTION_CRITERIA,
      classifier_url: `${REPO}/blob/HEAD/lib/wallets/classify.ts`,
      market_maker_exclusion_url: `${REPO}/blob/HEAD/supabase/migrations/016_capture_scope_exclude_market_makers.sql`,
      page_url: `${APP_URL}/cohort`,
    },
    // The download and the hash of exactly these bytes. Both are generated
    // from this same read, so they agree unless the cohort changes between
    // this response and the download.
    snapshot: {
      csv_url: `${APP_URL}/api/cohort/csv`,
      csv_sha256: sha256Hex(cohortCsv(wallets)),
      csv_columns: ['address', 'archetype', 'added_at'],
    },
    wallets: page.map(w => ({
      address: w.address,
      archetype: w.archetype,
      // Rate-normalized from the most recent classification sample, not a live
      // counter; null when the wallet has never been sampled — never 0.
      trade_count_30d: w.trade_count_30d,
      added_at: w.created_at,
      explorer_url: `https://hypurrscan.io/address/${w.address}`,
    })),
    next_cursor: nextCursor,
  })
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}
