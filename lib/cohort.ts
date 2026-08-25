import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

// The cohort snapshot behind /cohort and /api/cohort/csv. Both surfaces must
// read through this module so the SHA-256 shown on the page is the hash of
// exactly the bytes the CSV endpoint serves (for identical underlying data).
// Server-only: imports the service-role Supabase client's types.

export interface CohortWallet {
  address: string
  archetype: string | null
  trade_count_30d: number | null
  created_at: string
  last_updated: string | null
}

// PostgREST silently truncates near 1,000 rows (CLAUDE.md; two production
// bugs). Page with an order + range until a short page comes back — never
// assume one read returned the full cohort.
const PAGE_SIZE = 500

export async function loadCohort(supabase: SupabaseClient): Promise<CohortWallet[]> {
  const all: CohortWallet[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('wallets')
      .select('address,archetype,trade_count_30d,created_at,last_updated')
      .eq('capture_enabled', true)
      .is('removed_at', null)
      .order('address', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw error
    const rows = (data ?? []) as CohortWallet[]
    all.push(...rows)
    if (rows.length < PAGE_SIZE) break
  }
  return all
}

// Deterministic serialization: addresses are already sorted by the query
// order, fields are raw database values. Same data in, same bytes out — that
// is what makes the displayed hash auditable against the download.
export function cohortCsv(wallets: CohortWallet[]): string {
  const header = 'address,archetype,added_at'
  const lines = wallets.map(w => `${w.address},${w.archetype ?? ''},${w.created_at}`)
  return [header, ...lines].join('\n') + '\n'
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
