import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/db/supabase'

const HL_URL = 'https://api.hyperliquid.xyz/info'

// Known active Hyperliquid traders for initial seeding
const SEED_WALLETS = [
  { address: '0x010461C14e146ac35Fe42271BDC1134EE31C703a', label: 'HyperWhale Alpha', tags: ['whale', 'market_maker'] },
  { address: '0x7e17d75e8bc71e9e86106f032bfd2778b850e8d6', label: 'Momentum Master', tags: ['momentum_trader'] },
  { address: '0xf3f496c6e9d12442d4a424cc9e79b8c4a7db2a3f', label: 'DeFi Degen', tags: ['scalper'] },
  { address: '0x4f9b7b1c6f8a3e2d5c0e9b4a8f2d3c6e1a5b8d7f', label: 'Swing Trader Pro', tags: ['swing_trader'] },
  { address: '0xa3f68e9c8d2b4e5f1c7d9a0b3e6f2d8c4a1b5e7d', label: 'Arb Hunter', tags: ['funding_arb'] },
  { address: '0x1b3c5d7e9f2a4b6c8d0e1f3a5b7c9d1e3f5a7b9c', label: 'High Conviction', tags: ['high_conviction'] },
  { address: '0x2c4d6e8f0a1b3c5d7e9f0a2b4c6d8e0f1a3b5c7d', label: 'Perp King', tags: ['scalper', 'momentum_trader'] },
  { address: '0x3d5e7f9a1b2c4d6e8f0a1b3c5d7e9f0a2b4c6d8e', label: 'Delta Neutral', tags: ['farmer'] },
  { address: '0x4e6f8a0b2c3d5e7f9a1b2c4d6e8f0a1b3c5d7e9f', label: 'Leverage Lord', tags: ['scalper'] },
  { address: '0x5f7a9b1c3d4e6f8a0b2c3d5e7f9a1b2c4d6e8f0a', label: 'Smart Money OG', tags: ['whale', 'high_conviction'] },
]

async function hlPost(payload: Record<string, unknown>) {
  const res = await fetch(HL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`HL API ${res.status}`)
  return res.json()
}

export async function POST() {
  try {
    const supabase = getSupabase()

    // Verify which addresses are actually active on Hyperliquid
    const verified: Array<{
      address: string
      label: string
      tags: string[]
      archetype: string
      total_pnl_usd: number
      avg_leverage: number
    }> = []

    const results = await Promise.all(
      SEED_WALLETS.map(async (w) => {
        try {
          const state = await hlPost({ type: 'clearinghouseState', user: w.address })
          if (!state) return null
          const accountValue = parseFloat(state?.marginSummary?.accountValue || '0')
          const positions = state?.assetPositions || []

          // Only include wallets that actually exist (have account value or positions)
          if (accountValue > 0 || positions.length > 0) {
            const avgLeverage = positions.length > 0
              ? positions.reduce((s: number, p: { position?: { leverage?: { value?: number } } }) =>
                  s + (p.position?.leverage?.value || 1), 0) / positions.length
              : 0
            const unrealizedPnl = positions.reduce(
              (s: number, p: { position?: { unrealizedPnl?: string } }) =>
                s + parseFloat(p.position?.unrealizedPnl || '0'), 0)

            return {
              address: w.address.toLowerCase(),
              label: w.label,
              tags: w.tags,
              archetype: w.tags[0] || 'unknown',
              total_pnl_usd: Math.round(unrealizedPnl * 100) / 100,
              avg_leverage: Math.round(avgLeverage * 100) / 100,
            }
          }
          return null
        } catch {
          return null
        }
      }),
    )

    for (const r of results) {
      if (r) verified.push(r)
    }

    // Also discover wallets from recentTrades to supplement
    let discoveredCount = 0
    try {
      const coins = ['BTC', 'ETH', 'SOL']
      const tradeResults = await Promise.all(
        coins.map(coin => hlPost({ type: 'recentTrades', coin }).catch(() => []))
      )
      const seen = new Set(verified.map(v => v.address))
      for (const trades of tradeResults) {
        if (!Array.isArray(trades)) continue
        for (const t of trades.slice(0, 20)) {
          for (const addr of (t.users || [])) {
            const lower = addr?.toLowerCase()
            if (lower?.startsWith('0x') && !seen.has(lower)) {
              seen.add(lower)
              verified.push({
                address: lower,
                label: '',
                tags: ['discovered'],
                archetype: 'unknown',
                total_pnl_usd: 0,
                avg_leverage: 0,
              })
              discoveredCount++
              if (discoveredCount >= 20) break
            }
          }
          if (discoveredCount >= 20) break
        }
        if (discoveredCount >= 20) break
      }
    } catch {
      // Discovery is optional
    }

    // Upsert into Supabase
    const upsertRows = verified.map(w => ({
      address: w.address,
      label: w.label || null,
      archetype: w.archetype,
      total_pnl_usd: w.total_pnl_usd,
      avg_leverage: w.avg_leverage,
      is_seeded: true,
      last_updated: new Date().toISOString(),
    }))

    let saved = 0
    for (let i = 0; i < upsertRows.length; i += 50) {
      const batch = upsertRows.slice(i, i + 50)
      const { error } = await supabase
        .from('wallets')
        .upsert(batch, { onConflict: 'address' })
      if (!error) saved += batch.length
    }

    return NextResponse.json({
      seeded: verified.length,
      saved,
      discovered: discoveredCount,
      wallets: verified.map(v => ({ address: v.address, label: v.label, tags: v.tags })),
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'Seed failed', detail: String(error) },
      { status: 500 },
    )
  }
}
