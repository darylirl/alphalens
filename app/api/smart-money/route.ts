import { NextResponse } from 'next/server'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const HL_URL = 'https://api.hyperliquid.xyz/info'

const TIERS = [
  { name: 'Leviathan', emoji: '\u{1F409}', min: 5000000, max: Infinity },
  { name: 'Whale', emoji: '\u{1F40B}', min: 500000, max: 5000000 },
  { name: 'Shark', emoji: '\u{1F988}', min: 100000, max: 500000 },
  { name: 'Fish', emoji: '\u{1F41F}', min: 10000, max: 100000 },
  { name: 'Crab', emoji: '\u{1F980}', min: 1000, max: 10000 },
  { name: 'Shrimp', emoji: '\u{1F990}', min: 0, max: 1000 },
]

interface WalletPosition {
  coin: string
  size: number
  side: 'Long' | 'Short'
  notional: number
  leverage: number
  pnl: number
  entryPx: number
}

interface SmartMoneyWallet {
  address: string
  accountValue: number
  positions: WalletPosition[]
  totalLong: number
  totalShort: number
  positionCount: number
  cumulativePnl: number  // realized (closed) PnL from fills
  unrealizedPnl: number  // unrealized PnL from open positions
  totalPnl: number       // cumulative + unrealized
}

interface TierResult {
  name: string
  emoji: string
  min: number
  max: number
  wallets: SmartMoneyWallet[]
  totalLong: number
  totalShort: number
  longRatio: number
  sentiment: 'Bullish' | 'Bearish' | 'Neutral'
  netBias: number
  inPositionPct: number
  topCoins: Array<{ coin: string; notional: number; longPct: number }>
}

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
    // Step 1: Gather wallet addresses from multiple sources
    const addresses = new Set<string>()

    // Source A: Supabase seeded wallets (if available)
    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_ANON_KEY

    if (supabaseUrl && supabaseKey && !supabaseUrl.includes('your_')) {
      try {
        const { createClient } = await import('@supabase/supabase-js')
        const supabase = createClient(supabaseUrl, supabaseKey)
        const { data: wallets } = await supabase
          .from('wallets')
          .select('address')
          .limit(300)
        if (wallets) {
          for (const w of wallets) addresses.add(w.address)
        }
      } catch {}
    }

    // Source B: Discover from recent trades on major coins
    const discoveryCoins = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'SUI', 'WIF', 'ARB', 'OP', 'AVAX']
    const tradeResults = await Promise.all(
      discoveryCoins.map(coin =>
        hlPost({ type: 'recentTrades', coin }).catch(() => null)
      )
    )
    for (const trades of tradeResults) {
      if (!Array.isArray(trades)) continue
      for (const trade of trades) {
        const users = trade.users as string[] | undefined
        if (users) {
          for (const addr of users) {
            if (addr?.startsWith('0x')) addresses.add(addr)
          }
        }
      }
    }

    if (addresses.size === 0) {
      return NextResponse.json({ tiers: [], total: 0 })
    }

    // Step 2: Fetch clearinghouse state for all wallets (batched)
    const allAddrs = Array.from(addresses).slice(0, 250)
    const walletData: SmartMoneyWallet[] = []

    for (let i = 0; i < allAddrs.length; i += 20) {
      const batch = allAddrs.slice(i, i + 20)

      // Fetch clearinghouse state + recent fills in parallel per wallet
      const stateResults = await Promise.all(
        batch.map(addr =>
          hlPost({ type: 'clearinghouseState', user: addr }).catch(() => null)
        )
      )
      const fillResults = await Promise.all(
        batch.map(addr =>
          hlPost({ type: 'userFills', user: addr }).catch(() => null)
        )
      )

      for (let j = 0; j < batch.length; j++) {
        const state = stateResults[j]
        if (!state?.crossMarginSummary) continue

        const accountValue = parseFloat(state.crossMarginSummary.accountValue || '0')
        if (accountValue <= 0) continue

        const positions: WalletPosition[] = []
        let totalLong = 0
        let totalShort = 0
        let unrealizedPnl = 0

        for (const ap of state.assetPositions || []) {
          const pos = ap?.position
          if (!pos) continue
          const size = parseFloat(pos.szi || '0')
          if (size === 0) continue

          const notional = Math.abs(parseFloat(pos.positionValue || '0'))
          const pnl = parseFloat(pos.unrealizedPnl || '0')
          const leverage = pos.leverage?.value || 0
          const entryPx = parseFloat(pos.entryPx || '0')
          const side = size > 0 ? 'Long' as const : 'Short' as const

          unrealizedPnl += pnl
          if (side === 'Long') totalLong += notional
          else totalShort += notional

          positions.push({
            coin: pos.coin,
            size: Math.abs(size),
            side,
            notional,
            leverage,
            pnl,
            entryPx,
          })
        }

        // Compute cumulative realized PnL from fills
        let cumulativePnl = 0
        const fills = Array.isArray(fillResults[j]) ? fillResults[j] : []
        for (const fill of fills) {
          cumulativePnl += parseFloat(fill.closedPnl || '0')
        }

        // Sort positions by notional descending
        positions.sort((a, b) => b.notional - a.notional)

        walletData.push({
          address: batch[j],
          accountValue,
          positions,
          totalLong,
          totalShort,
          positionCount: positions.length,
          cumulativePnl: Math.round(cumulativePnl * 100) / 100,
          unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
          totalPnl: Math.round((cumulativePnl + unrealizedPnl) * 100) / 100,
        })
      }
    }

    // Step 3: Group into tiers and compute aggregates
    const tiers: TierResult[] = TIERS.map(tier => {
      const tierWallets = walletData
        .filter(w => w.accountValue >= tier.min && w.accountValue < tier.max)
        .sort((a, b) => b.accountValue - a.accountValue)

      const totalLong = tierWallets.reduce((s, w) => s + w.totalLong, 0)
      const totalShort = tierWallets.reduce((s, w) => s + w.totalShort, 0)
      const totalNotional = totalLong + totalShort
      const longRatio = totalNotional > 0 ? Math.round((totalLong / totalNotional) * 100) : 0
      const inPos = tierWallets.filter(w => w.positionCount > 0).length
      const inPositionPct = tierWallets.length > 0 ? Math.round((inPos / tierWallets.length) * 100) : 0
      const sentiment: 'Bullish' | 'Bearish' | 'Neutral' = longRatio > 55 ? 'Bullish' : longRatio < 45 ? 'Bearish' : 'Neutral'

      // Compute top coins across all wallets in this tier
      const coinMap: Record<string, { notional: number; long: number; short: number }> = {}
      for (const w of tierWallets) {
        for (const p of w.positions) {
          if (!coinMap[p.coin]) coinMap[p.coin] = { notional: 0, long: 0, short: 0 }
          coinMap[p.coin].notional += p.notional
          if (p.side === 'Long') coinMap[p.coin].long += p.notional
          else coinMap[p.coin].short += p.notional
        }
      }
      const topCoins = Object.entries(coinMap)
        .map(([coin, d]) => ({
          coin,
          notional: Math.round(d.notional),
          longPct: d.notional > 0 ? Math.round((d.long / d.notional) * 100) : 0,
        }))
        .sort((a, b) => b.notional - a.notional)
        .slice(0, 10)

      return {
        name: tier.name,
        emoji: tier.emoji,
        min: tier.min,
        max: tier.max,
        wallets: tierWallets.slice(0, 50), // Cap at 50 per tier for response size
        totalLong: Math.round(totalLong),
        totalShort: Math.round(totalShort),
        longRatio,
        sentiment,
        netBias: Math.round(totalLong - totalShort),
        inPositionPct,
        topCoins,
      }
    }).filter(t => t.wallets.length > 0)

    return NextResponse.json({
      tiers,
      total: walletData.length,
      scanned: allAddrs.length,
    })
  } catch (error) {
    console.error('Smart money API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
