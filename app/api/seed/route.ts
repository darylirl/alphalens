import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const HL_URL = 'https://api.hyperliquid.xyz/info'

export const maxDuration = 60

const TOP_COINS = ['BTC', 'ETH', 'SOL', 'ARB', 'DOGE', 'OP', 'AVAX', 'SUI', 'WIF', 'LINK', 'XRP', 'BNB', 'AAVE', 'INJ', 'TIA']

async function hlPost(payload: Record<string, unknown>) {
  const res = await fetch(HL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) return null
  return res.json()
}

export async function POST() {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey || supabaseUrl.includes('your_')) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 400 })
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  // Test Supabase connection
  const { error: testError } = await supabase.from('wallets').select('address').limit(1)
  if (testError) {
    return NextResponse.json({
      error: 'Supabase query failed',
      detail: testError.message,
      fix: 'Disable RLS on the wallets table: Supabase Dashboard > Table Editor > wallets > RLS Disabled'
    }, { status: 500 })
  }

  // Step 1: Discover active wallet addresses from recent trades across top coins
  const discoveredAddresses = new Set<string>()

  const tradePromises = TOP_COINS.map(coin =>
    hlPost({ type: 'recentTrades', coin }).catch(() => null)
  )

  const allTrades = await Promise.all(tradePromises)

  for (const trades of allTrades) {
    if (!Array.isArray(trades)) continue
    for (const trade of trades) {
      const users = trade.users as string[] | undefined
      if (users) {
        for (const addr of users) {
          if (addr && addr.startsWith('0x')) {
            discoveredAddresses.add(addr)
          }
        }
      }
    }
  }

  if (discoveredAddresses.size === 0) {
    return NextResponse.json({ error: 'No wallets discovered from recent trades' }, { status: 502 })
  }

  // Step 2: For each discovered wallet, fetch account state and compute metrics
  const addresses = Array.from(discoveredAddresses).slice(0, 100)
  const archetypes = ['scalper', 'swing_trader', 'momentum_trader', 'high_conviction', 'funding_arb']
  let seeded = 0
  const errors: string[] = []

  // Process in batches of 10 to avoid rate limits
  for (let batch = 0; batch < addresses.length; batch += 10) {
    const batchAddrs = addresses.slice(batch, batch + 10)

    const statePromises = batchAddrs.map(addr =>
      hlPost({ type: 'clearinghouseState', user: addr }).catch(() => null)
    )

    const states = await Promise.all(statePromises)

    for (let j = 0; j < batchAddrs.length; j++) {
      const address = batchAddrs[j]
      const state = states[j]
      if (!state) continue

      const accountValue = parseFloat(state?.crossMarginSummary?.accountValue || '0')

      // Skip wallets with very low account value
      if (accountValue < 100) continue

      const positions = state?.assetPositions || []
      let totalLeverage = 0
      let posCount = 0
      let mostTraded = 'BTC'
      let totalNotional = 0

      for (const ap of positions) {
        const pos = ap?.position
        if (pos && parseFloat(pos.szi || '0') !== 0) {
          totalLeverage += pos.leverage?.value || 5
          posCount++
          mostTraded = pos.coin || mostTraded
          totalNotional += Math.abs(parseFloat(pos.positionValue || '0'))
        }
      }

      const avgLeverage = posCount > 0 ? totalLeverage / posCount : 5
      const isLargeAccount = accountValue > 50000
      const isActive = posCount > 0

      // Classify archetype based on real metrics
      let archetype: string
      if (avgLeverage > 10 && posCount > 0) {
        archetype = 'scalper'
      } else if (avgLeverage <= 5 && accountValue > 100000) {
        archetype = 'high_conviction'
      } else if (posCount > 3) {
        archetype = 'momentum_trader'
      } else if (avgLeverage >= 3 && avgLeverage <= 10) {
        archetype = 'swing_trader'
      } else {
        archetype = archetypes[(batch + j) % archetypes.length]
      }

      const baseSharpe = isLargeAccount ? 1.0 + Math.random() * 1.5 : 0.3 + Math.random() * 1.0
      const baseWinRate = isActive ? 0.48 + Math.random() * 0.22 : 0.4 + Math.random() * 0.15

      const wallet = {
        address,
        label: null,
        archetype,
        archetype_confidence: Math.round((0.55 + Math.random() * 0.4) * 100) / 100,
        sharpe_7d: Math.round(baseSharpe * (0.7 + Math.random() * 0.6) * 1000) / 1000,
        sharpe_30d: Math.round(baseSharpe * (0.8 + Math.random() * 0.5) * 1000) / 1000,
        sharpe_90d: Math.round(baseSharpe * (0.85 + Math.random() * 0.3) * 1000) / 1000,
        alpha_decay_score: Math.round(Math.random() * 0.4 * 1000) / 1000,
        win_rate: Math.round(baseWinRate * 1000) / 1000,
        total_pnl_usd: Math.round(accountValue * (0.05 + Math.random() * 0.5) * (Math.random() > 0.35 ? 1 : -1) * 100) / 100,
        trade_count_30d: Math.floor(15 + Math.random() * 200),
        avg_hold_seconds: Math.floor(300 + Math.random() * 172800),
        avg_leverage: Math.round(avgLeverage * 100) / 100,
        most_traded_asset: mostTraded,
        is_seeded: true,
      }

      const { error } = await supabase
        .from('wallets')
        .upsert(wallet, { onConflict: 'address' })

      if (error) {
        if (errors.length < 5) errors.push(`${address.slice(0, 10)}: ${error.message}`)
      } else {
        seeded++
      }
    }
  }

  return NextResponse.json({
    success: seeded > 0,
    seeded,
    discovered: discoveredAddresses.size,
    errors: errors.length > 0 ? errors : undefined
  })
}
