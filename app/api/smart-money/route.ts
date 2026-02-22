import { NextResponse } from 'next/server'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const HL_URL = 'https://api.hyperliquid.xyz/info'

interface TierData {
  name: string
  emoji: string
  count: number
  sentiment: 'Bullish' | 'Bearish' | 'Neutral'
  inPosition: number
  longRatio: number
  netBias: number
}

const TIERS = [
  { name: 'Shrimp', emoji: '\u{1F990}', min: 0, max: 1000 },
  { name: 'Crab', emoji: '\u{1F980}', min: 1000, max: 10000 },
  { name: 'Fish', emoji: '\u{1F41F}', min: 10000, max: 100000 },
  { name: 'Shark', emoji: '\u{1F988}', min: 100000, max: 500000 },
  { name: 'Whale', emoji: '\u{1F40B}', min: 500000, max: 5000000 },
  { name: 'Leviathan', emoji: '\u{1F409}', min: 5000000, max: Infinity },
]

async function hlPost(payload: Record<string, unknown>) {
  const res = await fetch(HL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) return null
  return res.json()
}

export async function GET() {
  try {
    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseKey || supabaseUrl.includes('your_')) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 400 })
    }

    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data: wallets } = await supabase
      .from('wallets')
      .select('address')
      .limit(200)

    if (!wallets || wallets.length === 0) {
      return NextResponse.json({ tiers: [], total: 0 })
    }

    // Fetch clearinghouse state for each wallet in batches
    const addresses = wallets.map((w: { address: string }) => w.address)
    const tierMap: Record<string, { total: number; inPos: number; long: number; short: number; netBias: number }> = {}

    for (const tier of TIERS) {
      tierMap[tier.name] = { total: 0, inPos: 0, long: 0, short: 0, netBias: 0 }
    }

    // Process in batches of 20
    for (let i = 0; i < addresses.length; i += 20) {
      const batch = addresses.slice(i, i + 20)
      const results = await Promise.all(
        batch.map(addr => hlPost({ type: 'clearinghouseState', user: addr }).catch(() => null))
      )

      for (const state of results) {
        if (!state?.crossMarginSummary) continue
        const accountValue = parseFloat(state.crossMarginSummary.accountValue || '0')
        if (accountValue <= 0) continue

        const tier = TIERS.find(t => accountValue >= t.min && accountValue < t.max)
        if (!tier) continue

        const bucket = tierMap[tier.name]
        bucket.total++

        const positions = state.assetPositions || []
        let hasPosition = false
        let longNotional = 0
        let shortNotional = 0

        for (const ap of positions) {
          const pos = ap?.position
          if (!pos) continue
          const size = parseFloat(pos.szi || '0')
          if (size === 0) continue
          hasPosition = true
          const notional = Math.abs(parseFloat(pos.positionValue || '0'))
          if (size > 0) longNotional += notional
          else shortNotional += notional
        }

        if (hasPosition) bucket.inPos++
        bucket.long += longNotional
        bucket.short += shortNotional
        bucket.netBias += longNotional - shortNotional
      }
    }

    const tiers: TierData[] = TIERS.map(t => {
      const b = tierMap[t.name]
      const totalNotional = b.long + b.short
      const longRatio = totalNotional > 0 ? Math.round((b.long / totalNotional) * 100) : 0
      const inPosition = b.total > 0 ? Math.round((b.inPos / b.total) * 100) : 0
      const sentiment: 'Bullish' | 'Bearish' | 'Neutral' = longRatio > 55 ? 'Bullish' : longRatio < 45 ? 'Bearish' : 'Neutral'

      return {
        name: t.name,
        emoji: t.emoji,
        count: b.total,
        sentiment,
        inPosition,
        longRatio,
        netBias: Math.round(b.netBias),
      }
    }).filter(t => t.count > 0)

    return NextResponse.json({
      tiers,
      total: addresses.length,
    })
  } catch (error) {
    console.error('Smart money API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
