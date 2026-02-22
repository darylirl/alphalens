import { NextResponse } from 'next/server'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const HL_URL = 'https://api.hyperliquid.xyz/info'

async function hlPost(payload: Record<string, unknown>) {
  const res = await fetch(HL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) return null
  return res.json()
}

// Discover wallets from multiple Hyperliquid data sources
async function discoverWallets(): Promise<Map<string, { source: string; firstSeen: number }>> {
  const wallets = new Map<string, { source: string; firstSeen: number }>()
  const now = Date.now()

  // Source 1: Recent trades on top coins (most active traders)
  const topCoins = [
    'BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'SUI', 'WIF', 'ARB', 'OP', 'AVAX',
    'HYPE', 'LINK', 'AAVE', 'PENDLE', 'ONDO', 'TIA', 'RENDER', 'FET',
    'TRUMP', 'AI16Z', 'PEPE', 'BONK', 'INJ', 'SEI', 'APT', 'NEAR',
    'BNB', 'ADA', 'DOT', 'UNI', 'CRV', 'MKR', 'SNX', 'STX', 'ORDI',
  ]

  const tradeResults = await Promise.all(
    topCoins.map(coin => hlPost({ type: 'recentTrades', coin }).catch(() => null))
  )

  for (const trades of tradeResults) {
    if (!Array.isArray(trades)) continue
    for (const trade of trades) {
      const users = trade.users as string[] | undefined
      const time = trade.time || now
      if (users) {
        for (const addr of users) {
          if (addr?.startsWith('0x')) {
            const existing = wallets.get(addr)
            if (!existing || time < existing.firstSeen) {
              wallets.set(addr, { source: 'recentTrades', firstSeen: time })
            }
          }
        }
      }
    }
  }

  // Source 2: Hyperliquid leaderboard (top performing traders)
  // The leaderboard API gives us the best-performing wallets
  try {
    const leaderboardWindows = ['day', 'week', 'month', 'allTime']
    const lbResults = await Promise.all(
      leaderboardWindows.map(window =>
        hlPost({ type: 'leaderboard', window }).catch(() => null)
      )
    )
    for (const lb of lbResults) {
      if (!lb?.leaderboardRows) continue
      for (const row of lb.leaderboardRows) {
        const addr = row.ethAddress
        if (addr?.startsWith('0x') && !wallets.has(addr)) {
          wallets.set(addr, { source: 'leaderboard', firstSeen: now })
        }
      }
    }
  } catch {}

  // Source 3: Open orders on major pairs (people with limit orders = active participants)
  try {
    const l2Coins = ['BTC', 'ETH', 'SOL', 'HYPE']
    const l2Results = await Promise.all(
      l2Coins.map(coin => hlPost({ type: 'l2Book', coin, nSigFigs: 3 }).catch(() => null))
    )
    for (const book of l2Results) {
      if (!book?.levels) continue
      // L2 book doesn't expose addresses directly, but recentTrades covers this
    }
  } catch {}

  return wallets
}

export async function GET() {
  try {
    const wallets = await discoverWallets()

    if (wallets.size === 0) {
      return NextResponse.json({ error: 'No wallets discovered', wallets: [] }, { status: 200 })
    }

    // Enrich top wallets with account data
    const allAddrs = Array.from(wallets.keys())
    const enriched: Array<{
      address: string
      source: string
      accountValue: number
      positionCount: number
      totalNotional: number
      unrealizedPnl: number
      topPositions: Array<{ coin: string; side: string; notional: number }>
    }> = []

    // Process in batches of 25
    for (let i = 0; i < Math.min(allAddrs.length, 500); i += 25) {
      const batch = allAddrs.slice(i, i + 25)
      const states = await Promise.all(
        batch.map(addr => hlPost({ type: 'clearinghouseState', user: addr }).catch(() => null))
      )

      for (let j = 0; j < batch.length; j++) {
        const state = states[j]
        if (!state?.crossMarginSummary) continue

        const accountValue = parseFloat(state.crossMarginSummary.accountValue || '0')
        if (accountValue <= 0) continue

        const positions: Array<{ coin: string; side: string; notional: number }> = []
        let totalNotional = 0
        let unrealizedPnl = 0

        for (const ap of state.assetPositions || []) {
          const pos = ap?.position
          if (!pos) continue
          const size = parseFloat(pos.szi || '0')
          if (size === 0) continue

          const notional = Math.abs(parseFloat(pos.positionValue || '0'))
          unrealizedPnl += parseFloat(pos.unrealizedPnl || '0')
          totalNotional += notional
          positions.push({
            coin: pos.coin,
            side: size > 0 ? 'Long' : 'Short',
            notional: Math.round(notional),
          })
        }

        positions.sort((a, b) => b.notional - a.notional)

        const info = wallets.get(batch[j])
        enriched.push({
          address: batch[j],
          source: info?.source || 'unknown',
          accountValue: Math.round(accountValue * 100) / 100,
          positionCount: positions.length,
          totalNotional: Math.round(totalNotional),
          unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
          topPositions: positions.slice(0, 5),
        })
      }
    }

    // Sort by account value (biggest wallets first)
    enriched.sort((a, b) => b.accountValue - a.accountValue)

    // Compute stats
    const totalDiscovered = wallets.size
    const totalEnriched = enriched.length
    const totalAccountValue = enriched.reduce((s, w) => s + w.accountValue, 0)
    const totalNotional = enriched.reduce((s, w) => s + w.totalNotional, 0)
    const activeTraders = enriched.filter(w => w.positionCount > 0).length

    // Tier distribution
    const tierDist: Record<string, number> = {}
    for (const w of enriched) {
      let tier = 'Shrimp'
      if (w.accountValue >= 5000000) tier = 'Leviathan'
      else if (w.accountValue >= 500000) tier = 'Whale'
      else if (w.accountValue >= 100000) tier = 'Shark'
      else if (w.accountValue >= 10000) tier = 'Fish'
      else if (w.accountValue >= 1000) tier = 'Crab'
      tierDist[tier] = (tierDist[tier] || 0) + 1
    }

    // Source distribution
    const sourceDist: Record<string, number> = {}
    for (const [, info] of wallets) {
      sourceDist[info.source] = (sourceDist[info.source] || 0) + 1
    }

    // Save to Supabase if configured
    let savedToDb = 0
    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_ANON_KEY
    if (supabaseUrl && supabaseKey && !supabaseUrl.includes('your_')) {
      try {
        const { createClient } = await import('@supabase/supabase-js')
        const supabase = createClient(supabaseUrl, supabaseKey)

        // Batch upsert enriched wallets
        for (let i = 0; i < enriched.length; i += 50) {
          const batch = enriched.slice(i, i + 50).map(w => ({
            address: w.address,
            is_seeded: true,
          }))
          const { error } = await supabase.from('wallets').upsert(batch, { onConflict: 'address', ignoreDuplicates: true })
          if (!error) savedToDb += batch.length
        }
      } catch {}
    }

    return NextResponse.json({
      stats: {
        totalDiscovered,
        totalEnriched,
        activeTraders,
        totalAccountValue: Math.round(totalAccountValue),
        totalNotional: Math.round(totalNotional),
        tierDistribution: tierDist,
        sourceDistribution: sourceDist,
        savedToDb,
      },
      wallets: enriched,
    })
  } catch (error) {
    console.error('Scanner error:', error)
    return NextResponse.json({ error: 'Scanner failed' }, { status: 500 })
  }
}
