import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const HL_URL = 'https://api.hyperliquid.xyz/info'

export const maxDuration = 60

export async function POST() {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey || supabaseUrl.includes('your_')) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 400 })
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  // Step 1: Test Supabase connection
  const { error: testError } = await supabase.from('wallets').select('address').limit(1)
  if (testError) {
    return NextResponse.json({
      error: 'Supabase query failed - check RLS policies',
      detail: testError.message,
      fix: 'Go to Supabase > Authentication > Policies, and add a policy to allow all operations on the wallets table, or disable RLS on it'
    }, { status: 500 })
  }

  // Step 2: Fetch leaderboard from Hyperliquid
  let rows: Array<Record<string, unknown>> = []
  try {
    const lbRes = await fetch(HL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'leaderboard' }),
    })

    if (!lbRes.ok) {
      const text = await lbRes.text()
      return NextResponse.json({
        error: `Hyperliquid API returned ${lbRes.status}`,
        detail: text.slice(0, 500)
      }, { status: 502 })
    }

    const result = await lbRes.json()

    if (Array.isArray(result)) {
      rows = result
    } else if (result?.leaderboardRows) {
      rows = result.leaderboardRows
    } else {
      return NextResponse.json({
        error: 'Unexpected leaderboard response format',
        keys: Object.keys(result || {}),
        sample: JSON.stringify(result).slice(0, 500)
      }, { status: 502 })
    }
  } catch (fetchErr) {
    return NextResponse.json({
      error: 'Failed to fetch Hyperliquid leaderboard',
      detail: String(fetchErr)
    }, { status: 502 })
  }

  if (!rows.length) {
    return NextResponse.json({ error: 'Leaderboard returned 0 rows' }, { status: 502 })
  }

  // Step 3: Seed wallets
  const archetypes = ['scalper', 'swing_trader', 'momentum_trader', 'high_conviction', 'funding_arb']
  const top = rows.slice(0, 100)
  let seeded = 0
  const errors: string[] = []

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
      archetype_confidence: Math.round((0.65 + Math.random() * 0.3) * 100) / 100,
      sharpe_7d: Math.round((roi > 0 ? 0.3 + roi * 1.5 : roi) * 1000) / 1000,
      sharpe_30d: Math.round((roi > 0 ? 0.5 + roi * 2 : roi) * 1000) / 1000,
      sharpe_90d: Math.round((roi > 0 ? 0.4 + roi * 1.8 : roi) * 1000) / 1000,
      alpha_decay_score: Math.round(Math.random() * 0.35 * 1000) / 1000,
      win_rate: Math.round((totalPnl > 0 ? 0.5 + Math.random() * 0.25 : 0.3 + Math.random() * 0.2) * 1000) / 1000,
      total_pnl_usd: Math.round(totalPnl * 100) / 100,
      trade_count_30d: Math.floor(20 + Math.random() * 180),
      avg_hold_seconds: Math.floor(300 + Math.random() * 86400),
      avg_leverage: Math.round((3 + Math.random() * 12) * 100) / 100,
      most_traded_asset: ['BTC', 'ETH', 'SOL', 'ARB', 'DOGE'][Math.floor(Math.random() * 5)],
      is_seeded: true,
    }

    const { error } = await supabase
      .from('wallets')
      .upsert(wallet, { onConflict: 'address' })

    if (error) {
      if (errors.length < 3) errors.push(`${address.slice(0, 8)}: ${error.message}`)
    } else {
      seeded++
    }
  }

  return NextResponse.json({
    success: seeded > 0,
    seeded,
    total: top.length,
    errors: errors.length > 0 ? errors : undefined
  })
}
