import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const HL_URL = 'https://api.hyperliquid.xyz/info'

export async function POST() {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey || supabaseUrl.includes('your_')) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  try {
    // Fetch leaderboard
    const lbRes = await fetch(HL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'leaderboard' }),
    })

    if (!lbRes.ok) {
      return NextResponse.json({ error: `HL API error: ${lbRes.status}` }, { status: 502 })
    }

    const result = await lbRes.json()
    let rows: Array<Record<string, unknown>> = []
    if (Array.isArray(result)) {
      rows = result
    } else if (result?.leaderboardRows) {
      rows = result.leaderboardRows
    }

    if (!rows.length) {
      return NextResponse.json({ error: 'No leaderboard data returned' }, { status: 502 })
    }

    const archetypes = ['scalper', 'swing_trader', 'momentum_trader', 'high_conviction', 'funding_arb']
    const top = rows.slice(0, 100)
    let seeded = 0

    for (const row of top) {
      const address = row.ethAddress as string
      if (!address) continue

      const perfs = (row.windowPerformances || []) as Array<{ window: string; pnl: string; roi: string }>
      const pnlAll = perfs.find((p) => p.window === 'allTime')
      const totalPnl = pnlAll ? parseFloat(pnlAll.pnl) : 0
      const roi = pnlAll ? parseFloat(pnlAll.roi) : 0
      const idx = seeded % archetypes.length

      const wallet = {
        address,
        label: (row.displayName as string) || null,
        archetype: archetypes[idx],
        archetype_confidence: 0.65 + Math.random() * 0.3,
        sharpe_7d: roi > 0 ? 0.3 + roi * 1.5 : roi,
        sharpe_30d: roi > 0 ? 0.5 + roi * 2 : roi,
        sharpe_90d: roi > 0 ? 0.4 + roi * 1.8 : roi,
        alpha_decay_score: Math.random() * 0.35,
        win_rate: totalPnl > 0 ? 0.5 + Math.random() * 0.25 : 0.3 + Math.random() * 0.2,
        total_pnl_usd: totalPnl,
        trade_count_30d: Math.floor(20 + Math.random() * 180),
        avg_hold_seconds: Math.floor(300 + Math.random() * 86400),
        avg_leverage: 3 + Math.random() * 12,
        most_traded_asset: ['BTC', 'ETH', 'SOL', 'ARB', 'DOGE'][Math.floor(Math.random() * 5)],
        is_seeded: true,
      }

      const { error } = await supabase
        .from('wallets')
        .upsert(wallet, { onConflict: 'address' })

      if (!error) seeded++
    }

    return NextResponse.json({ success: true, seeded, total: top.length })
  } catch (error) {
    console.error('Seed error:', error)
    return NextResponse.json({ error: 'Seed failed' }, { status: 500 })
  }
}
