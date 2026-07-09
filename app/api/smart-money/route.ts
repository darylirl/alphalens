import { NextResponse } from 'next/server'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const HL_URL = 'https://api.hyperliquid.xyz/info'

// ── Asset classification ──
// Dynamically fetches universe from Hyperliquid and classifies each asset
const CATEGORY_RULES: Record<string, string[]> = {
  'Major': ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'DOT', 'LINK', 'LTC', 'BCH', 'ETC'],
  'AI & Compute': ['AI', 'AI16Z', 'AIXBT', 'FET', 'RENDER', 'RNDR', 'IO', 'TAO', 'GRASS', 'GRIFFAIN', 'VIRTUAL', 'GOAT'],
  'Meme': ['DOGE', 'WIF', 'PNUT', 'FARTCOIN', 'TRUMP', 'MELANIA', 'BRETT', 'POPCAT', 'MEW', 'BOME',
           'MOODENG', 'TURBO', 'CHILLGUY', 'MYRO', 'HPOS', 'SPX', 'VINE', 'TST', 'YZY',
           'kBONK', 'kDOGS', 'kFLOKI', 'kLUNC', 'kNEIRO', 'kPEPE', 'kSHIB'],
  'DeFi': ['AAVE', 'UNI', 'COMP', 'MKR', 'CRV', 'DYDX', 'GMX', 'LDO', 'PENDLE', 'SNX', 'SUSHI',
           'STG', 'RSR', 'ENS', 'ONDO', 'ENA', 'EIGEN', 'ETHFI', 'MORPHO', 'USUAL', 'STABLE', 'SYRUP', 'RESOLV'],
  'L1 & L2': ['ARB', 'OP', 'SUI', 'NEAR', 'APT', 'SEI', 'TIA', 'STRK', 'MANTA', 'ZK', 'ZETA',
              'BLAST', 'LINEA', 'S', 'MOVE', 'INIT', 'BERA', 'HYPE', 'HYPER', 'LAYER', 'MON', 'SOPH'],
  'Gaming & NFT': ['AXS', 'IMX', 'GALA', 'ILV', 'PIXEL', 'SUPER', 'YGG', 'BIGTIME', 'MAVIA', 'NFTI', 'DOOD',
                   'ANIME', 'PENGU', 'SAND', 'MEGA', 'PURR'],
  'Infrastructure': ['FIL', 'AR', 'PYTH', 'GAS', 'ORBS', 'RLB', 'W', 'ORDI', 'STX', 'KAS', 'ICP', 'IOTA',
                     'HBAR', 'XLM', 'XMR', 'ZEC', 'TRX', 'ATOM', 'RUNE', 'TON', 'NEO'],
  'Index & Commodity': ['PAXG'],
  // Stock perps — auto-detected by checking if name matches known stock tickers
  // When Hyperliquid adds stock perps, they'll appear here
}

// Known stock tickers for auto-detection (common US equities)
const STOCK_TICKERS = new Set([
  'AAPL', 'AMZN', 'GOOG', 'GOOGL', 'META', 'MSFT', 'NVDA', 'TSLA', 'AMD', 'INTC',
  'NFLX', 'DIS', 'PYPL', 'SQ', 'SHOP', 'UBER', 'ABNB', 'COIN', 'HOOD', 'RBLX',
  'GME', 'AMC', 'PLTR', 'SNAP', 'PINS', 'SPOT', 'ZM', 'ROKU', 'CRWD', 'NET',
  'SNOW', 'DKNG', 'MSTR', 'SPY', 'QQQ', 'IWM', 'DIA', 'GLD', 'SLV', 'USO',
])

function classifyAsset(name: string): { category: string; isStock: boolean } {
  // Check stock tickers first (including @ prefix Hyperliquid may use)
  const cleanName = name.replace(/^@/, '')
  if (STOCK_TICKERS.has(cleanName)) {
    return { category: 'Stock Perps', isStock: true }
  }

  for (const [category, tickers] of Object.entries(CATEGORY_RULES)) {
    if (tickers.includes(name)) return { category, isStock: false }
  }

  return { category: 'Other', isStock: false }
}

// ── Equity tiers ──
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

// ── Types ──
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
  tags: string[]
  positions: WalletPosition[]
  totalLong: number
  totalShort: number
  positionCount: number
  cumulativePnl: number
  unrealizedPnl: number
  totalPnl: number
  fundingPnl: number
  firstTradeTime: number | null
}

// ── Fetch true all-time PnL and account age from the portfolio endpoint ──
// The fills endpoint retains only a wallet's most recent ~2000 fills, so
// summing closedPnl over fills wildly understates all-time PnL for active
// wallets (measured on a live market maker: $2.3K from fills vs the true
// $4.4M) and dates "Since" to hours ago instead of years. The portfolio
// endpoint reports the exchange-computed all-time PnL curve, inclusive of
// realized, unrealized, and funding PnL.
async function fetchAllTimePnl(address: string): Promise<{ allTimePnl: number; firstTradeTime: number | null }> {
  const data = await hlPost({ type: 'portfolio', user: address }).catch(() => null)
  if (!Array.isArray(data)) return { allTimePnl: 0, firstTradeTime: null }

  const allTimeEntry = data.find((e: [string, unknown]) => e?.[0] === 'allTime')
  const allTime = allTimeEntry?.[1] as { pnlHistory?: [number, string][] } | undefined
  const history = allTime?.pnlHistory
  if (!history || history.length === 0) return { allTimePnl: 0, firstTradeTime: null }

  return {
    allTimePnl: parseFloat(history[history.length - 1][1]) || 0,
    firstTradeTime: history[0][0] || null,
  }
}

// ── Fetch lifetime funding PnL ──
async function fetchFundingPnl(address: string): Promise<number> {
  let total = 0
  const data = await hlPost({ type: 'userFunding', user: address, startTime: 0 }).catch(() => null)
  if (Array.isArray(data)) {
    for (const f of data) total += parseFloat(f?.delta?.usdc || '0')
  }
  return total
}

// ── Confidence scoring ──
function computeConfidence(
  walletCount: number,
  longNotional: number,
  shortNotional: number,
  tierWeights: Record<string, number>,
) {
  const totalNotional = longNotional + shortNotional
  if (totalNotional === 0 || walletCount === 0) {
    return { score: 0, factors: { consensus: 0, liquidity: 0, participation: 0, whaleAlignment: 0 } }
  }

  const dominantPct = Math.max(longNotional, shortNotional) / totalNotional
  const consensus = Math.round(((dominantPct - 0.5) / 0.5) * 10 * 10) / 10

  const liquidityScore = Math.min(10, Math.round(Math.log10(Math.max(totalNotional, 1)) * 1.5 * 10) / 10)

  const participationScore = Math.min(10, Math.round(Math.sqrt(walletCount) * 2 * 10) / 10)

  const bigTierCount = (tierWeights['Leviathan'] || 0) * 4 +
    (tierWeights['Whale'] || 0) * 3 +
    (tierWeights['Shark'] || 0) * 2 +
    (tierWeights['Fish'] || 0) * 1
  const totalWeighted = Object.values(tierWeights).reduce((s, v) => s + v, 0)
  const whaleAlignment = totalWeighted > 0
    ? Math.min(10, Math.round((bigTierCount / totalWeighted) * 5 * 10) / 10)
    : 0

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

// ── Narrative insight generator ──
function generateInsight(
  category: string,
  tokens: Array<{ coin: string; direction: string; confidence: number; totalLiquidity: number; walletCount: number; longPct: number }>,
): string {
  if (tokens.length === 0) return ''

  const totalLiquidity = tokens.reduce((s, t) => s + t.totalLiquidity, 0)
  const totalWallets = tokens.reduce((s, t) => s + t.walletCount, 0)
  const bullishCount = tokens.filter(t => t.direction === 'Long').length
  const bearishCount = tokens.filter(t => t.direction === 'Short').length
  const avgConfidence = tokens.reduce((s, t) => s + t.confidence, 0) / tokens.length

  const topCoin = tokens[0]
  const sectorBias = bullishCount > bearishCount ? 'bullish' : bearishCount > bullishCount ? 'bearish' : 'mixed'

  const parts: string[] = []

  // Sector sentiment
  parts.push(`${category} sector is ${sectorBias} overall`)

  // Liquidity
  const liqStr = totalLiquidity >= 1e6 ? `$${(totalLiquidity / 1e6).toFixed(1)}M` : `$${(totalLiquidity / 1e3).toFixed(0)}K`
  parts.push(`${liqStr} deployed across ${tokens.length} asset${tokens.length > 1 ? 's' : ''}`)

  // Participation
  parts.push(`${totalWallets} wallet${totalWallets > 1 ? 's' : ''} active`)

  // Top conviction play
  if (topCoin) {
    parts.push(`Highest conviction: ${topCoin.coin} (${topCoin.longPct}% long, confidence ${topCoin.confidence}/10)`)
  }

  return parts.join('. ') + '.'
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
    // Step 0: Fetch full universe to get market data for all assets
    const universeData = await hlPost({ type: 'metaAndAssetCtxs' })
    const meta = Array.isArray(universeData) ? universeData[0] : universeData?.meta
    const assetCtxs = Array.isArray(universeData) ? universeData[1] : universeData?.assetCtxs
    const universe = meta?.universe || []

    // Build asset info map (price, volume, 24h change)
    const assetInfo: Record<string, { price: number; volume: number; change24h: number; category: string; isStock: boolean }> = {}
    for (let i = 0; i < universe.length; i++) {
      const name = universe[i]?.name
      const ctx = assetCtxs?.[i]
      if (!name) continue
      const markPx = parseFloat(ctx?.markPx || '0')
      const prevPx = parseFloat(ctx?.prevDayPx || '0')
      const vol = parseFloat(ctx?.dayNtlVlm || '0')
      const change = prevPx > 0 ? ((markPx - prevPx) / prevPx) * 100 : 0
      const { category, isStock } = classifyAsset(name)
      assetInfo[name] = { price: markPx, volume: vol, change24h: Math.round(change * 100) / 100, category, isStock }
    }

    // Count stock perps found
    const stockPerpsFound = Object.values(assetInfo).filter(a => a.isStock).length

    // Step 1: Gather wallet addresses
    const addresses = new Set<string>()
    const walletTagsMap = new Map<string, string[]>()

    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY

    if (supabaseUrl && supabaseKey && !supabaseUrl.includes('your_')) {
      try {
        const { createClient } = await import('@supabase/supabase-js')
        const supabase = createClient(supabaseUrl, supabaseKey)
        const { data: wallets } = await supabase.from('wallets').select('address, tags').limit(300)
        if (wallets) for (const w of wallets) {
          addresses.add(w.address)
          if (w.tags?.length) walletTagsMap.set(w.address.toLowerCase(), w.tags)
        }
      } catch {}
    }

    // Discover from recent trades — include more coins for broader coverage
    const discoveryCoins = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'SUI', 'WIF', 'ARB', 'OP', 'AVAX',
      'HYPE', 'AI16Z', 'TRUMP', 'PENDLE', 'ONDO', 'TIA', 'RENDER', 'FET', 'LINK', 'AAVE']
    // Also try any stock perps found in universe
    for (const [name, info] of Object.entries(assetInfo)) {
      if (info.isStock) discoveryCoins.push(name)
    }
    const uniqueDiscovery = [...new Set(discoveryCoins)]

    const tradeResults = await Promise.all(
      uniqueDiscovery.map(coin => hlPost({ type: 'recentTrades', coin }).catch(() => null))
    )
    for (const trades of tradeResults) {
      if (!Array.isArray(trades)) continue
      for (const trade of trades) {
        const users = trade.users as string[] | undefined
        if (users) for (const addr of users) if (addr?.startsWith('0x')) addresses.add(addr)
      }
    }

    if (addresses.size === 0) {
      return NextResponse.json({ tokens: [], sectorInsights: [], tierSummary: [], total: 0, stockPerpsAvailable: stockPerpsFound })
    }

    // Step 2: Fetch wallet data with all-time PnL
    const allAddrs = Array.from(addresses).slice(0, 250)
    const walletData: SmartMoneyWallet[] = []

    for (let i = 0; i < allAddrs.length; i += 20) {
      const batch = allAddrs.slice(i, i + 20)

      // Fetch state, all-time PnL, and funding in parallel per batch
      const stateResults = await Promise.all(
        batch.map(addr => hlPost({ type: 'clearinghouseState', user: addr }).catch(() => null))
      )
      const pnlResults = await Promise.all(
        batch.map(addr => fetchAllTimePnl(addr))
      )
      const fundingResults = await Promise.all(
        batch.map(addr => fetchFundingPnl(addr))
      )

      for (let j = 0; j < batch.length; j++) {
        const state = stateResults[j]
        if (!state?.crossMarginSummary) continue

        const accountValue = parseFloat(state.crossMarginSummary.accountValue || '0')
        if (accountValue <= 0) continue

        const positions: WalletPosition[] = []
        let totalLong = 0, totalShort = 0, unrealizedPnl = 0

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

        const { allTimePnl, firstTradeTime } = pnlResults[j]
        const fundingPnl = fundingResults[j]

        positions.sort((a, b) => b.notional - a.notional)

        // The portfolio all-time PnL already includes realized, unrealized,
        // and funding PnL — so it IS the total, and realized is derived as
        // total minus current unrealized (no double counting).
        walletData.push({
          address: batch[j], accountValue, tier: getTierName(accountValue),
          tags: walletTagsMap.get(batch[j].toLowerCase()) || [],
          positions, totalLong, totalShort, positionCount: positions.length,
          cumulativePnl: Math.round((allTimePnl - unrealizedPnl) * 100) / 100,
          unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
          totalPnl: Math.round(allTimePnl * 100) / 100,
          fundingPnl: Math.round(fundingPnl * 100) / 100,
          firstTradeTime,
        })
      }
    }

    // Step 3: Build token-centric view with categories
    const tokenMap: Record<string, {
      longNotional: number; shortNotional: number
      longWallets: SmartMoneyWallet[]; shortWallets: SmartMoneyWallet[]
      tierCounts: Record<string, number>; totalPnl: number
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
        const uniqueWallets = allWallets.filter((w, i) => allWallets.findIndex(x => x.address === w.address) === i)
        const walletCount = uniqueWallets.length
        const totalNotional = data.longNotional + data.shortNotional
        const longPct = totalNotional > 0 ? Math.round((data.longNotional / totalNotional) * 100) : 0
        const direction: 'Long' | 'Short' | 'Mixed' = longPct > 60 ? 'Long' : longPct < 40 ? 'Short' : 'Mixed'

        const confidence = computeConfidence(walletCount, data.longNotional, data.shortNotional, data.tierCounts)

        const tierBreakdown = EQUITY_TIERS
          .filter(t => data.tierCounts[t.name])
          .map(t => ({ tier: t.name, emoji: t.emoji, count: data.tierCounts[t.name] || 0 }))

        const walletsForCoin = uniqueWallets
          .map(w => {
            const coinPositions = w.positions.filter(p => p.coin === coin)
            const coinNotional = coinPositions.reduce((s, p) => s + p.notional, 0)
            const coinSide = coinPositions.length > 0 ? coinPositions[0].side : 'Long' as const
            const coinPnl = coinPositions.reduce((s, p) => s + p.pnl, 0)
            const coinLeverage = coinPositions.length > 0 ? coinPositions[0].leverage : 0
            return {
              address: w.address, accountValue: w.accountValue, tier: w.tier,
              tags: w.tags,
              side: coinSide, notional: coinNotional, pnl: Math.round(coinPnl * 100) / 100,
              leverage: coinLeverage, totalPnl: w.totalPnl,
              cumulativePnl: w.cumulativePnl, fundingPnl: w.fundingPnl,
              firstTradeTime: w.firstTradeTime,
            }
          })
          .sort((a, b) => b.notional - a.notional)
          .slice(0, 20)

        const info = assetInfo[coin]
        const category = info?.category || 'Other'
        const isStock = info?.isStock || false

        return {
          coin, direction, longPct,
          totalLiquidity: Math.round(totalNotional),
          longNotional: Math.round(data.longNotional),
          shortNotional: Math.round(data.shortNotional),
          walletCount,
          confidence: confidence.score,
          confidenceFactors: confidence.factors,
          tierBreakdown,
          wallets: walletsForCoin,
          aggregatePnl: Math.round(data.totalPnl * 100) / 100,
          // New: category + market data
          category,
          isStock,
          price: info?.price || 0,
          change24h: info?.change24h || 0,
          volume24h: Math.round(info?.volume || 0),
        }
      })
      .sort((a, b) => b.totalLiquidity - a.totalLiquidity)

    // Step 4: Generate sector insights
    const sectorMap: Record<string, typeof tokens> = {}
    for (const token of tokens) {
      const cat = token.category
      if (!sectorMap[cat]) sectorMap[cat] = []
      sectorMap[cat].push(token)
    }

    const sectorInsights = Object.entries(sectorMap)
      .map(([category, sectorTokens]) => {
        const totalLiquidity = sectorTokens.reduce((s, t) => s + t.totalLiquidity, 0)
        const totalWallets = sectorTokens.reduce((s, t) => s + t.walletCount, 0)
        const avgConfidence = sectorTokens.length > 0
          ? Math.round((sectorTokens.reduce((s, t) => s + t.confidence, 0) / sectorTokens.length) * 10) / 10
          : 0
        const bullish = sectorTokens.filter(t => t.direction === 'Long').length
        const bearish = sectorTokens.filter(t => t.direction === 'Short').length
        const bias: 'Bullish' | 'Bearish' | 'Mixed' = bullish > bearish ? 'Bullish' : bearish > bullish ? 'Bearish' : 'Mixed'

        const narrative = generateInsight(category, sectorTokens)
        const isStock = sectorTokens.some(t => t.isStock)

        return {
          category,
          isStock,
          tokenCount: sectorTokens.length,
          totalLiquidity: Math.round(totalLiquidity),
          totalWallets,
          avgConfidence,
          bias,
          narrative,
          topToken: sectorTokens[0]?.coin || '',
          topTokenConfidence: sectorTokens[0]?.confidence || 0,
        }
      })
      .sort((a, b) => b.totalLiquidity - a.totalLiquidity)

    // Tier summary with wallet details for clickable tiers
    const tierSummary = EQUITY_TIERS.map(tier => {
      const tierWallets = walletData.filter(w => w.tier === tier.name)
      const totalLong = tierWallets.reduce((s, w) => s + w.totalLong, 0)
      const totalShort = tierWallets.reduce((s, w) => s + w.totalShort, 0)
      const totalNotional = totalLong + totalShort
      const longRatio = totalNotional > 0 ? Math.round((totalLong / totalNotional) * 100) : 0
      const avgPnl = tierWallets.length > 0 ? tierWallets.reduce((s, w) => s + w.totalPnl, 0) / tierWallets.length : 0

      // Include top wallets for this tier (sorted by account value)
      const wallets = tierWallets
        .sort((a, b) => b.accountValue - a.accountValue)
        .slice(0, 50)
        .map(w => ({
          address: w.address,
          accountValue: Math.round(w.accountValue * 100) / 100,
          tags: w.tags,
          positionCount: w.positionCount,
          totalLong: Math.round(w.totalLong),
          totalShort: Math.round(w.totalShort),
          cumulativePnl: w.cumulativePnl,
          unrealizedPnl: w.unrealizedPnl,
          totalPnl: w.totalPnl,
          fundingPnl: w.fundingPnl,
          firstTradeTime: w.firstTradeTime,
          topPositions: w.positions.slice(0, 3).map(p => ({
            coin: p.coin, side: p.side, notional: Math.round(p.notional),
            leverage: p.leverage, pnl: Math.round(p.pnl * 100) / 100,
          })),
        }))

      return {
        name: tier.name, emoji: tier.emoji, count: tierWallets.length,
        longRatio, totalNotional: Math.round(totalNotional),
        avgPnl: Math.round(avgPnl * 100) / 100,
        totalPnl: Math.round(tierWallets.reduce((s, w) => s + w.totalPnl, 0) * 100) / 100,
        wallets,
      }
    }).filter(t => t.count > 0)

    return NextResponse.json({
      tokens,
      sectorInsights,
      tierSummary,
      total: walletData.length,
      scanned: allAddrs.length,
      stockPerpsAvailable: stockPerpsFound,
      categories: [...new Set(tokens.map(t => t.category))].sort(),
    })
  } catch (error) {
    console.error('Smart money API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
