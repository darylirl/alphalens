import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const limit = parseInt(searchParams.get('limit') || '50')
  const archetype = searchParams.get('archetype')
  const sort = searchParams.get('sort') || 'sharpe_30d'

  try {
    // Query Supabase for seeded wallets
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

      const { data, error } = await query

      if (error) {
        return NextResponse.json({ error: error.message, hint: 'Check RLS policies' }, { status: 500 })
      }

      return NextResponse.json(data || [])
    }

    return NextResponse.json([])
  } catch (error) {
    console.error('Hunters API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
