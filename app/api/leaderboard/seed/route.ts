import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/db/supabase'

const HL_URL = 'https://api.hyperliquid.xyz/info'

// Honesty remediation: the previous list contained nine synthetic addresses
// with invented persona labels and archetype tags no classifier ever
// assigned. Only verified real addresses may be listed, with factual labels
// (null until a real one exists) and NO pre-assigned tags — classification
// comes from the classifier, not from this file.
const SEED_WALLETS: Array<{ address: string; label: string | null; tags: string[] }> = [
  { address: '0x010461C14e146ac35Fe42271BDC1134EE31C703a', label: null, tags: [] },
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
      label: string | null
      tags: string[]
      archetype: string | null
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
              archetype: w.tags[0] || null,
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
        .upsert(batch, { onConflict: 'address', ignoreDuplicates: true })
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
