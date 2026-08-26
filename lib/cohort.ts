import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

// The cohort snapshot behind /cohort and /api/cohort/csv. Both surfaces must
// read through this module so the SHA-256 shown on the page is the hash of
// exactly the bytes the CSV endpoint serves (for identical underlying data).
// Server-only: imports the service-role Supabase client's types.

// Versioned marker on the public cohort JSON, mirroring ledger.v0: fields may
// be added over time but existing ones are never renamed or removed.
export const COHORT_SCHEMA = 'cohort.v0'

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

// Example wallets for the /card and /replay index pages: a small, live,
// archetype-varied sample of the capture cohort so a visitor can try the
// surface without owning an address. The read is bounded on purpose — an
// ordered top slice intended as a cap (CLAUDE.md: never an unbounded
// PostgREST read) — and callers render an honest empty state on failure,
// never a hardcoded list.
const EXAMPLE_POOL_LIMIT = 200

export async function loadExampleWallets(
  supabase: SupabaseClient,
  count = 4,
): Promise<CohortWallet[]> {
  const { data, error } = await supabase
    .from('wallets')
    .select('address,archetype,trade_count_30d,created_at,last_updated')
    .eq('capture_enabled', true)
    .is('removed_at', null)
    .order('trade_count_30d', { ascending: false, nullsFirst: false })
    .limit(EXAMPLE_POOL_LIMIT)
  if (error) throw error
  const pool = (data ?? []) as CohortWallet[]

  // One wallet per archetype, most active first, so the examples vary.
  const picked: CohortWallet[] = []
  const seenArchetypes = new Set<string>()
  for (const w of pool) {
    const key = w.archetype ?? 'unclassified'
    if (seenArchetypes.has(key)) continue
    seenArchetypes.add(key)
    picked.push(w)
    if (picked.length >= count) break
  }
  // Fewer archetypes in the pool than asked for: top up by activity.
  for (const w of pool) {
    if (picked.length >= count) break
    if (!picked.includes(w)) picked.push(w)
  }
  return picked
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
