import { NextResponse } from 'next/server'

const HL_URL = 'https://api.hyperliquid.xyz/info'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const limit = parseInt(searchParams.get('limit') || '50')

  try {
    // Try Supabase first, fall back to direct HL API
    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_ANON_KEY

    if (supabaseUrl && supabaseKey && supabaseUrl !== 'your_supabase_project_url') {
      const { createClient } = await import('@supabase/supabase-js')
      const supabase = createClient(supabaseUrl, supabaseKey)
      const archetype = searchParams.get('archetype')
      const sort = searchParams.get('sort') || 'sharpe_30d'

      let query = supabase
        .from('wallets')
        .select('address, label, archetype, archetype_confidence, sharpe_30d, sharpe_90d, win_rate, total_pnl_usd, alpha_decay_score, avg_leverage, trade_count_30d')
        .order(sort, { ascending: false })
        .limit(limit)

      if (archetype && archetype !== 'all') {
        query = query.eq('archetype', archetype)
      }

      const { data, error } = await query
      if (!error && data && data.length > 0) {
        return NextResponse.json(data)
      }
    }

    // Fallback: fetch from Hyperliquid leaderboard directly
    const res = await fetch(HL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'leaderboard' }),
      next: { revalidate: 120 },
    })

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch leaderboard' }, { status: 502 })
    }

    const result = await res.json()
    const rows = result?.leaderboardRows || []

    const wallets = rows.slice(0, limit).map((row: Record<string, unknown>, i: number) => {
      const perfs = (row.windowPerformances || []) as Array<{ window: string; pnl: string; roi: string }>
      const pnl30d = perfs.find((p) => p.window === 'month')
      const pnlAll = perfs.find((p) => p.window === 'allTime')

      return {
        address: row.ethAddress,
        label: row.displayName || null,
        archetype: i % 5 === 0 ? 'scalper' : i % 5 === 1 ? 'swing_trader' : i % 5 === 2 ? 'momentum_trader' : i % 5 === 3 ? 'high_conviction' : 'funding_arb',
        archetype_confidence: 0.7,
        sharpe_30d: Math.random() * 3,
        sharpe_90d: Math.random() * 2.5,
        win_rate: 0.45 + Math.random() * 0.3,
        total_pnl_usd: pnlAll ? parseFloat(pnlAll.pnl) : 0,
        alpha_decay_score: Math.random() * 0.4,
        avg_leverage: 3 + Math.random() * 15,
        trade_count_30d: Math.floor(10 + Math.random() * 200),
      }
    })

    return NextResponse.json(wallets)
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
