import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { computeWalletMetrics } from '@/lib/wallets/classify'
import { computeSharpe } from '@/lib/analytics/pnl'
import type { Fill, ClearinghouseState } from '@/lib/hyperliquid/types'

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

/** Convert a cumulative PnL curve into per-calendar-day PnL deltas so
 *  computeSharpe's daily-period assumption actually holds. */
function dailyPnlsFromCurve(history: [number, string][] | undefined): number[] {
  if (!history || history.length < 2) return []
  const lastByDay = new Map<string, number>()
  for (const [ts, v] of history) {
    lastByDay.set(new Date(ts).toISOString().slice(0, 10), parseFloat(v) || 0)
  }
  const vals = [...lastByDay.values()]
  const out: number[] = []
  for (let i = 1; i < vals.length; i++) out.push(vals[i] - vals[i - 1])
  return out
}

interface PortfolioDerived {
  totalPnl: number | null
  sharpe7d: number | null
  sharpe30d: number | null
}

/** Real PnL and risk metrics from the exchange-computed portfolio curves. */
async function fetchPortfolioMetrics(address: string): Promise<PortfolioDerived> {
  const data = await hlPost({ type: 'portfolio', user: address }).catch(() => null)
  if (!Array.isArray(data)) return { totalPnl: null, sharpe7d: null, sharpe30d: null }

  const byName = new Map<string, { pnlHistory?: [number, string][] }>(data as [string, { pnlHistory?: [number, string][] }][])
  const allTime = byName.get('allTime')?.pnlHistory
  const totalPnl = allTime && allTime.length > 0
    ? parseFloat(allTime[allTime.length - 1][1]) || 0
    : null

  const s7 = computeSharpe(dailyPnlsFromCurve(byName.get('week')?.pnlHistory))
  const s30 = computeSharpe(dailyPnlsFromCurve(byName.get('month')?.pnlHistory))

  return {
    totalPnl: totalPnl !== null ? Math.round(totalPnl * 100) / 100 : null,
    sharpe7d: isNaN(s7) ? null : s7,
    sharpe30d: isNaN(s30) ? null : s30,
  }
}

// Also support GET for Vercel cron jobs
export async function GET(req: Request) {
  // Verify cron secret if set (optional security)
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runSeed()
}

export async function POST() {
  return runSeed()
}

async function runSeed() {
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

  const allTrades = await Promise.all(
    TOP_COINS.map(coin => hlPost({ type: 'recentTrades', coin }).catch(() => null))
  )

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

  // Step 2: For each discovered wallet, compute REAL metrics. Every stored
  // value is derived from exchange data (fills, positions, portfolio curves)
  // or stored as null when the evidence doesn't exist — nothing is fabricated.
  const addresses = Array.from(discoveredAddresses).slice(0, 100)
  const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000
  let seeded = 0
  const errors: string[] = []
  let tagsColumnMissing = false

  // Process in batches of 10 to avoid rate limits
  for (let batchStart = 0; batchStart < addresses.length; batchStart += 10) {
    const batchAddrs = addresses.slice(batchStart, batchStart + 10)

    const [states, fillsResults, portfolios] = await Promise.all([
      Promise.all(batchAddrs.map(addr => hlPost({ type: 'clearinghouseState', user: addr }).catch(() => null))),
      Promise.all(batchAddrs.map(addr =>
        hlPost({ type: 'userFillsByTime', user: addr, startTime: ninetyDaysAgo })
          .then(d => (Array.isArray(d) ? (d as Fill[]) : []))
          .catch(() => [] as Fill[])
      )),
      Promise.all(batchAddrs.map(addr => fetchPortfolioMetrics(addr))),
    ])

    for (let j = 0; j < batchAddrs.length; j++) {
      const address = batchAddrs[j]
      const state = states[j] as ClearinghouseState | null
      if (!state?.crossMarginSummary) continue

      const accountValue = parseFloat(state.crossMarginSummary.accountValue || '0')

      // Skip wallets with very low account value
      if (accountValue < 100) continue

      // Real leverage from current positions
      let totalLeverage = 0
      let posCount = 0
      for (const ap of state.assetPositions || []) {
        const pos = ap?.position
        if (pos && parseFloat(pos.szi || '0') !== 0) {
          totalLeverage += pos.leverage?.value || 0
          posCount++
        }
      }
      const avgLeverage = posCount > 0 ? Math.round((totalLeverage / posCount) * 100) / 100 : null

      const metrics = computeWalletMetrics(fillsResults[j], state)
      const portfolio = portfolios[j]
      const primaryTag = metrics.tags.find(t => t !== 'unclassified') || null

      const wallet: Record<string, unknown> = {
        address,
        label: null,
        archetype: primaryTag,
        archetype_confidence: null, // no principled confidence measure yet
        sharpe_7d: portfolio.sharpe7d,
        sharpe_30d: portfolio.sharpe30d,
        sharpe_90d: null, // allTime curve is too coarse for a 90d estimate
        alpha_decay_score: null,
        win_rate: metrics.winRate !== null ? Math.round(metrics.winRate * 1000) / 1000 : null,
        total_pnl_usd: portfolio.totalPnl,
        trade_count_30d: metrics.tradeCount30d,
        avg_hold_seconds: metrics.avgHoldSeconds,
        avg_leverage: avgLeverage,
        most_traded_asset: metrics.mostTradedCoin,
        is_seeded: true,
        last_updated: new Date().toISOString(),
        tags: metrics.tags,
      }

      // Merge on conflict so re-seeding REPAIRS previously fabricated rows
      // (the old ignoreDuplicates:true made bad data permanent).
      let { error } = await supabase
        .from('wallets')
        .upsert(wallet, { onConflict: 'address' })

      // The tags column ships in migration 002; retry without it when the
      // migration has not been applied yet.
      if (error && error.message.includes('tags')) {
        tagsColumnMissing = true
        delete wallet.tags
        const retry = await supabase.from('wallets').upsert(wallet, { onConflict: 'address' })
        error = retry.error
      }

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
    tagsColumnMissing: tagsColumnMissing || undefined,
    errors: errors.length > 0 ? errors : undefined
  })
}
