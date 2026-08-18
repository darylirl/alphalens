import { NextResponse } from 'next/server'
import { validateSortColumn, safeParseInt, safeParseFloat } from '@/lib/validation'

// Track if we've already triggered a seed in this instance
let seedTriggered = false

// Canonical archetype vocabulary — must match lib/wallets/classify.ts,
// the only source that writes archetypes. (The old list contained values
// like high_conviction/funding_arb/farmer that are never stored, so those
// filters always returned zero rows.)
const VALID_ARCHETYPES = new Set([
  'all', 'market_maker', 'momentum_trader', 'basis_trader',
  'whale', 'scalper', 'swing_trader',
])

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const limit = safeParseInt(searchParams.get('limit'), 50, 1, 200)
  const rawArchetype = searchParams.get('archetype')
  const archetype = rawArchetype && VALID_ARCHETYPES.has(rawArchetype) ? rawArchetype : null
  const sort = validateSortColumn(searchParams.get('sort'))

  // Advanced filters (validated)
  const minTrades = searchParams.get('minTrades') ? safeParseInt(searchParams.get('minTrades'), 0, 0, 100000) : null
  const minWinRate = searchParams.get('minWinRate') ? safeParseFloat(searchParams.get('minWinRate'), 0, 0, 100) : null
  const minPnl = searchParams.get('minPnl') ? safeParseFloat(searchParams.get('minPnl'), 0, -1e9, 1e9) : null
  const maxLeverage = searchParams.get('maxLeverage') ? safeParseFloat(searchParams.get('maxLeverage'), 100, 0, 200) : null

  try {
    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY

    if (supabaseUrl && supabaseKey && !supabaseUrl.includes('your_')) {
      const { createClient } = await import('@supabase/supabase-js')
      const supabase = createClient(supabaseUrl, supabaseKey)

      let query = supabase
        .from('wallets')
        .select('address, label, archetype, archetype_confidence, sharpe_30d, sharpe_90d, win_rate, total_pnl_usd, alpha_decay_score, avg_leverage, trade_count_30d')
        .order(sort, { ascending: false })
        .limit(limit)

      if (archetype && archetype !== 'all') {
        query = query.eq('archetype', archetype)
      }

      // Apply advanced filters (pre-validated)
      if (minTrades !== null) {
        query = query.gte('trade_count_30d', minTrades)
      }
      if (minWinRate !== null) {
        query = query.gte('win_rate', minWinRate / 100)
      }
      if (minPnl !== null) {
        query = query.gte('total_pnl_usd', minPnl)
      }
      if (maxLeverage !== null) {
        query = query.lte('avg_leverage', maxLeverage)
      }

      const { data, error } = await query

      if (error) {
        return NextResponse.json({ error: error.message, hint: 'Check RLS policies' }, { status: 500 })
      }

      // Auto-seed: if table is empty, trigger seed in the background
      if ((!data || data.length === 0) && !seedTriggered && minTrades === null && minWinRate === null && minPnl === null && maxLeverage === null) {
        seedTriggered = true
        // Use request origin (same-origin) to avoid SSRF from env manipulation
        const origin = new URL(req.url).origin
        fetch(`${origin}/api/seed`, { method: 'POST' }).catch(() => {})
        return NextResponse.json({ seeding: true, message: 'Discovering wallets from Hyperliquid... Refresh in ~30 seconds.' })
      }

      return NextResponse.json(data || [])
    }

    return NextResponse.json([])
  } catch (error) {
    console.error('Hunters API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
