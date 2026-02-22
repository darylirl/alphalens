import { NextResponse } from 'next/server'

// Track if we've already triggered a seed in this instance
let seedTriggered = false

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const limit = parseInt(searchParams.get('limit') || '50')
  const archetype = searchParams.get('archetype')
  const sort = searchParams.get('sort') || 'sharpe_30d'

  // Advanced filters
  const minTrades = searchParams.get('minTrades')
  const minWinRate = searchParams.get('minWinRate')
  const minPnl = searchParams.get('minPnl')
  const maxLeverage = searchParams.get('maxLeverage')

  try {
    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_ANON_KEY

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

      // Apply advanced filters
      if (minTrades) {
        query = query.gte('trade_count_30d', parseInt(minTrades))
      }
      if (minWinRate) {
        query = query.gte('win_rate', parseFloat(minWinRate) / 100)
      }
      if (minPnl) {
        query = query.gte('total_pnl_usd', parseFloat(minPnl))
      }
      if (maxLeverage) {
        query = query.lte('avg_leverage', parseFloat(maxLeverage))
      }

      const { data, error } = await query

      if (error) {
        return NextResponse.json({ error: error.message, hint: 'Check RLS policies' }, { status: 500 })
      }

      // Auto-seed: if table is empty, trigger seed in the background
      if ((!data || data.length === 0) && !seedTriggered && !minTrades && !minWinRate && !minPnl && !maxLeverage) {
        seedTriggered = true
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
        fetch(`${baseUrl}/api/seed`, { method: 'POST' }).catch(() => {})
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
