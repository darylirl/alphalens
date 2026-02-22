import { NextResponse } from 'next/server'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const HL_URL = 'https://api.hyperliquid.xyz/info'

const EQUITY_TIERS = [
  { name: 'Leviathan', emoji: '\u{1F409}', min: 5000000 },
  { name: 'Whale', emoji: '\u{1F40B}', min: 500000 },
  { name: 'Shark', emoji: '\u{1F988}', min: 100000 },
  { name: 'Fish', emoji: '\u{1F41F}', min: 10000 },
  { name: 'Crab', emoji: '\u{1F980}', min: 1000 },
  { name: 'Shrimp', emoji: '\u{1F990}', min: 0 },
]

function getTierName(accountValue: number): string {
  for (const t of EQUITY_TIERS) {
    if (accountValue >= t.min) return t.name
  }
  return 'Shrimp'
}

function getTierEmoji(name: string): string {
  return EQUITY_TIERS.find(t => t.name === name)?.emoji || ''
}

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
  tier: string
  positions: WalletPosition[]
  totalLong: number
  totalShort: number
  positionCount: number
  cumulativePnl: number
  unrealizedPnl: number
  totalPnl: number
}

// Per-coin confidence scoring algorithm
// Factors: directional consensus, capital commitment, wallet count, tier weight
function computeConfidence(
  walletCount: number,
  longNotional: number,
  shortNotional: number,
  tierWeights: Record<string, number>, // how many wallets from each tier
  totalLiquidity: number
): { score: number; factors: { consensus: number; liquidity: number; participation: number; whaleAlignment: number } } {
  const totalNotional = longNotional + shortNotional
  if (totalNotional === 0 || walletCount === 0) {
    return { score: 0, factors: { consensus: 0, liquidity: 0, participation: 0, whaleAlignment: 0 } }
  }

  // Factor 1: Directional consensus (0-10)
  // How aligned are wallets? 100% one direction = 10, 50/50 = 0
  const dominantPct = Math.max(longNotional, shortNotional) / totalNotional
  const consensus = Math.round(((dominantPct - 0.5) / 0.5) * 10 * 10) / 10 // 0-10 scale

  // Factor 2: Liquidity depth (0-10)
  // More capital behind the trade = higher confidence
  // Scale: $100K = 3, $1M = 5, $10M = 7, $100M = 9, $1B = 10
  const liquidityScore = Math.min(10, Math.round(Math.log10(Math.max(totalNotional, 1)) * 1.5 * 10) / 10)

  // Factor 3: Participation breadth (0-10)
  // More wallets trading this coin = more signal
  // Scale: 1 wallet = 1, 5 = 4, 10 = 6, 25 = 8, 50+ = 10
  const participationScore = Math.min(10, Math.round(Math.sqrt(walletCount) * 2 * 10) / 10)

  // Factor 4: Whale/shark alignment (0-10)
  // If big wallets agree with the direction, confidence goes up
  const bigTierCount = (tierWeights['Leviathan'] || 0) * 4 +
    (tierWeights['Whale'] || 0) * 3 +
    (tierWeights['Shark'] || 0) * 2 +
    (tierWeights['Fish'] || 0) * 1
  const totalWeighted = Object.values(tierWeights).reduce((s, v) => s + v, 0)
  const whaleAlignment = totalWeighted > 0
    ? Math.min(10, Math.round((bigTierCount / totalWeighted) * 5 * 10) / 10)
    : 0

  // Weighted composite: consensus 35%, liquidity 25%, participation 20%, whale alignment 20%
  const composite = consensus * 0.35 + liquidityScore * 0.25 + participationScore * 0.2 + whaleAlignment * 0.2
  const score = Math.round(Math.min(10, Math.max(0, composite)) * 10) / 10

  return {
    score,
    factors: {
      consensus: Math.round(consensus * 10) / 10,
      liquidity: Math.round(liquidityScore * 10) / 10,
      participation: Math.round(participationScore * 10) / 10,
      whaleAlignment: Math.round(whaleAlignment * 10) / 10,
    },
  }
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
    // Step 1: Gather wallet addresses
    const addresses = new Set<string>()

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
      return NextResponse.json({ tokens: [], tiers: [], total: 0 })
    }

    // Step 2: Fetch clearinghouse state + fills for all wallets
    const allAddrs = Array.from(addresses).slice(0, 250)
    const walletData: SmartMoneyWallet[] = []

    for (let i = 0; i < allAddrs.length; i += 20) {
      const batch = allAddrs.slice(i, i + 20)

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

          positions.push({ coin: pos.coin, size: Math.abs(size), side, notional, leverage, pnl, entryPx })
        }

        let cumulativePnl = 0
        const fills = Array.isArray(fillResults[j]) ? fillResults[j] : []
        for (const fill of fills) {
          cumulativePnl += parseFloat(fill.closedPnl || '0')
        }

        positions.sort((a, b) => b.notional - a.notional)

        walletData.push({
          address: batch[j],
          accountValue,
          tier: getTierName(accountValue),
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

    // Step 3: Build TOKEN-CENTRIC view with confidence scores
    const tokenMap: Record<string, {
      longNotional: number
      shortNotional: number
      longWallets: SmartMoneyWallet[]
      shortWallets: SmartMoneyWallet[]
      tierCounts: Record<string, number>
      totalPnl: number
    }> = {}

    for (const wallet of walletData) {
      for (const pos of wallet.positions) {
        if (!tokenMap[pos.coin]) {
          tokenMap[pos.coin] = { longNotional: 0, shortNotional: 0, longWallets: [], shortWallets: [], tierCounts: {}, totalPnl: 0 }
        }
        const t = tokenMap[pos.coin]
        if (pos.side === 'Long') {
          t.longNotional += pos.notional
          if (!t.longWallets.find(w => w.address === wallet.address)) t.longWallets.push(wallet)
        } else {
          t.shortNotional += pos.notional
          if (!t.shortWallets.find(w => w.address === wallet.address)) t.shortWallets.push(wallet)
        }
        t.tierCounts[wallet.tier] = (t.tierCounts[wallet.tier] || 0) + 1
        t.totalPnl += pos.pnl
      }
    }

    const tokens = Object.entries(tokenMap)
      .map(([coin, data]) => {
        const allWallets = [...data.longWallets, ...data.shortWallets]
        // Deduplicate wallets that appear in both long and short
        const uniqueWallets = allWallets.filter((w, i) => allWallets.findIndex(x => x.address === w.address) === i)
        const walletCount = uniqueWallets.length
        const totalNotional = data.longNotional + data.shortNotional
        const longPct = totalNotional > 0 ? Math.round((data.longNotional / totalNotional) * 100) : 0
        const direction: 'Long' | 'Short' | 'Mixed' = longPct > 60 ? 'Long' : longPct < 40 ? 'Short' : 'Mixed'

        const confidence = computeConfidence(walletCount, data.longNotional, data.shortNotional, data.tierCounts, totalNotional)

        // Build tier breakdown for this coin
        const tierBreakdown = EQUITY_TIERS
          .filter(t => data.tierCounts[t.name])
          .map(t => ({
            tier: t.name,
            emoji: t.emoji,
            count: data.tierCounts[t.name] || 0,
          }))

        // Top wallets for this coin (sorted by notional in this coin)
        const walletsForCoin = uniqueWallets
          .map(w => {
            const coinPositions = w.positions.filter(p => p.coin === coin)
            const coinNotional = coinPositions.reduce((s, p) => s + p.notional, 0)
            const coinSide = coinPositions.length > 0 ? coinPositions[0].side : 'Long' as const
            const coinPnl = coinPositions.reduce((s, p) => s + p.pnl, 0)
            const coinLeverage = coinPositions.length > 0 ? coinPositions[0].leverage : 0
            return {
              address: w.address,
              accountValue: w.accountValue,
              tier: w.tier,
              side: coinSide,
              notional: coinNotional,
              pnl: Math.round(coinPnl * 100) / 100,
              leverage: coinLeverage,
              totalPnl: w.totalPnl,
            }
          })
          .sort((a, b) => b.notional - a.notional)
          .slice(0, 20)

        return {
          coin,
          direction,
          longPct,
          totalLiquidity: Math.round(totalNotional),
          longNotional: Math.round(data.longNotional),
          shortNotional: Math.round(data.shortNotional),
          walletCount,
          confidence: confidence.score,
          confidenceFactors: confidence.factors,
          tierBreakdown,
          wallets: walletsForCoin,
          aggregatePnl: Math.round(data.totalPnl * 100) / 100,
        }
      })
      .sort((a, b) => b.totalLiquidity - a.totalLiquidity)

    // Also keep equity tier overview (lighter weight, for the summary)
    const tierSummary = EQUITY_TIERS.map(tier => {
      const tierWallets = walletData.filter(w => w.tier === tier.name)
      const totalLong = tierWallets.reduce((s, w) => s + w.totalLong, 0)
      const totalShort = tierWallets.reduce((s, w) => s + w.totalShort, 0)
      const totalNotional = totalLong + totalShort
      const longRatio = totalNotional > 0 ? Math.round((totalLong / totalNotional) * 100) : 0
      return {
        name: tier.name,
        emoji: tier.emoji,
        count: tierWallets.length,
        longRatio,
        totalNotional: Math.round(totalNotional),
      }
    }).filter(t => t.count > 0)

    return NextResponse.json({
      tokens,
      tierSummary,
      total: walletData.length,
      scanned: allAddrs.length,
    })
  } catch (error) {
    console.error('Smart money API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
