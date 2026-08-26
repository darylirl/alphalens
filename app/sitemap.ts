import type { MetadataRoute } from 'next'
import { getSupabase } from '@/lib/db/supabase'
import { APP_URL } from '@/lib/ledger/api'

// Served per request so new Ledger permalinks appear without a redeploy.
// The only query is a light, explicitly paginated id/timestamp read.
export const dynamic = 'force-dynamic'

const staticRoutes: Array<{ path: string; priority: number }> = [
  { path: '', priority: 1 },
  { path: '/ledger', priority: 0.9 },
  { path: '/research', priority: 0.9 },
  { path: '/research/copy-trading-autopsy', priority: 0.8 },
  { path: '/cohort', priority: 0.8 },
  { path: '/card', priority: 0.8 },
  { path: '/replay', priority: 0.8 },
  { path: '/ledger/methodology', priority: 0.7 },
  { path: '/docs/api', priority: 0.7 },
  { path: '/pulse', priority: 0.7 },
  { path: '/hunters', priority: 0.5 },
  { path: '/wallets', priority: 0.5 },
  { path: '/smart-money', priority: 0.5 },
  { path: '/performance', priority: 0.5 },
  { path: '/learn', priority: 0.4 },
]

const PAGE_SIZE = 1000 // under PostgREST's silent ~1000-row truncation cap
const MAX_ENTRIES = 10_000 // sitemap sanity bound, far above today's call count

/** Every ledger call id, explicitly paged until a short page comes back. */
async function loadCallIds(): Promise<Array<{ id: number; published_at: string; resolved_at: string | null }>> {
  const all: Array<{ id: number; published_at: string; resolved_at: string | null }> = []
  try {
    const supabase = getSupabase()
    for (let offset = 0; all.length < MAX_ENTRIES; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('ledger_calls')
        .select('id,published_at,resolved_at')
        .order('id', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1)
      if (error) throw error
      const page = (data || []) as Array<{ id: number; published_at: string; resolved_at: string | null }>
      all.push(...page)
      if (page.length < PAGE_SIZE) break
    }
  } catch {
    // The static routes still ship; call permalinks reappear next fetch.
  }
  return all
}

/** Cohort wallet addresses for /card and /replay permalinks, explicitly
 *  paged until a short page comes back. */
async function loadCohortAddresses(): Promise<Array<{ address: string; last_updated: string | null }>> {
  const all: Array<{ address: string; last_updated: string | null }> = []
  try {
    const supabase = getSupabase()
    for (let offset = 0; all.length < MAX_ENTRIES; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('wallets')
        .select('address,last_updated')
        .eq('capture_enabled', true)
        .is('removed_at', null)
        .order('address', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1)
      if (error) throw error
      const page = (data || []) as Array<{ address: string; last_updated: string | null }>
      all.push(...page)
      if (page.length < PAGE_SIZE) break
    }
  } catch {
    // The static routes still ship; wallet permalinks reappear next fetch.
  }
  return all
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [calls, cohort] = await Promise.all([loadCallIds(), loadCohortAddresses()])
  return [
    ...staticRoutes.map(({ path, priority }) => ({
      url: `${APP_URL}${path}`,
      priority,
    })),
    ...calls.map((c) => ({
      url: `${APP_URL}/ledger/${c.id}`,
      lastModified: c.resolved_at ?? c.published_at,
      priority: 0.6,
    })),
    ...cohort.flatMap((w) => [
      {
        url: `${APP_URL}/card/${w.address}`,
        lastModified: w.last_updated ?? undefined,
        priority: 0.5,
      },
      {
        url: `${APP_URL}/replay/${w.address}`,
        lastModified: w.last_updated ?? undefined,
        priority: 0.5,
      },
    ]),
  ]
}
