import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/db/supabase'
import { getRedis } from '@/lib/cache/redis'

// Live data endpoint — must never be executed at build time
export const dynamic = 'force-dynamic'

const HL_URL = 'https://api.hyperliquid.xyz/info'
const CACHE_KEY = 'leaderboard:v1'
const CACHE_TTL = 60 // seconds
const BATCH_SIZE = 15

interface LeaderboardEntry {
  rank: number
  address: string
  label: string | null
  realized_pnl: number
  unrealized_pnl: number
  total_pnl: number
  account_value: number
  last_updated: string
}

async function hlPost(payload: Record<string, unknown>) {
  const res = await fetch(HL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`HL API ${res.status}`)
  return res.json()
}

async function fetchWalletPnl(address: string): Promise<{
  realizedPnl: number
  unrealizedPnl: number
  accountValue: number
} | null> {
  try {
    const now = Date.now()
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000

    const [fills, state] = await Promise.all([
      hlPost({ type: 'userFillsByTime', user: address, startTime: thirtyDaysAgo }),
      hlPost({ type: 'clearinghouseState', user: address }),
    ])

    // Sum realized PnL from fills
    const realizedPnl = Array.isArray(fills)
      ? fills.reduce((sum: number, f: { closedPnl?: string }) => sum + parseFloat(f.closedPnl || '0'), 0)
      : 0

    // Sum unrealized PnL from open positions
    const positions = state?.assetPositions || []
    const unrealizedPnl = positions.reduce(
      (sum: number, p: { position?: { unrealizedPnl?: string } }) =>
        sum + parseFloat(p.position?.unrealizedPnl || '0'),
      0,
    )

    const accountValue = parseFloat(state?.marginSummary?.accountValue || '0')

    return { realizedPnl, unrealizedPnl, accountValue }
  } catch {
    return null
  }
}

export async function GET() {
  try {
    // Try Redis cache first
    const redis = getRedis()
    if (redis) {
      try {
        const cached = await redis.get<LeaderboardEntry[]>(CACHE_KEY)
        if (cached) {
          return NextResponse.json(cached, {
            headers: { 'X-Cache': 'HIT' },
          })
        }
      } catch {
        // Redis unavailable — fall through to fresh fetch
      }
    }

    // Fetch all tracked wallets from Supabase
    const supabase = getSupabase()
    const allWallets: Array<{ address: string; label: string | null }> = []
    const PAGE_SIZE = 1000
    let offset = 0

    while (true) {
      const { data, error } = await supabase
        .from('wallets')
        .select('address, label')
        .range(offset, offset + PAGE_SIZE - 1)

      if (error || !data || data.length === 0) break
      allWallets.push(...data)
      if (data.length < PAGE_SIZE) break
      offset += PAGE_SIZE
    }

    if (allWallets.length === 0) {
      return NextResponse.json({ error: 'No tracked wallets found. Run /api/leaderboard/seed first.' }, { status: 404 })
    }

    // Fetch PnL for each wallet in parallel batches
    const results: Array<LeaderboardEntry> = []
    const now = new Date().toISOString()

    for (let i = 0; i < allWallets.length; i += BATCH_SIZE) {
      const batch = allWallets.slice(i, i + BATCH_SIZE)
      const batchResults = await Promise.all(
        batch.map(async (w) => {
          const pnl = await fetchWalletPnl(w.address)
          if (!pnl) return null
          return {
            rank: 0,
            address: w.address,
            label: w.label,
            realized_pnl: Math.round(pnl.realizedPnl * 100) / 100,
            unrealized_pnl: Math.round(pnl.unrealizedPnl * 100) / 100,
            total_pnl: Math.round((pnl.realizedPnl + pnl.unrealizedPnl) * 100) / 100,
            account_value: Math.round(pnl.accountValue * 100) / 100,
            last_updated: now,
          }
        }),
      )
      for (const r of batchResults) {
        if (r) results.push(r)
      }
    }

    // Sort by total PnL descending and assign ranks
    results.sort((a, b) => b.total_pnl - a.total_pnl)
    results.forEach((entry, i) => { entry.rank = i + 1 })

    // Cache in Redis
    if (redis) {
      try {
        await redis.set(CACHE_KEY, results, { ex: CACHE_TTL })
      } catch {
        // Redis write failed — non-fatal
      }
    }

    return NextResponse.json(results, {
      headers: { 'X-Cache': 'MISS' },
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to build leaderboard', detail: String(error) },
      { status: 500 },
    )
  }
}
