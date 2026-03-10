import { NextRequest, NextResponse } from 'next/server'
import { getUserFills, getUserFundings } from '@/lib/hyperliquid/client'
import type { Fill, UserFunding } from '@/lib/hyperliquid/types'

const ETH_RE = /^0x[a-fA-F0-9]{40}$/
const VALID_DAYS = [7, 30, 90]

interface DailyPnl {
  date: string
  pnl: number
  cumulative: number
}

interface AssetBreakdown {
  coin: string
  pnl: number
  trades: number
  volume: number
}

interface TradeStats {
  totalTrades: number
  winRate: number
  avgTradeSizeUsd: number
  largestWin: number
  largestLoss: number
  avgHoldTimeSeconds: number
  profitFactor: number
  grossProfit: number
  grossLoss: number
}

function computeDailyPnl(fills: Fill[]): DailyPnl[] {
  const byDay = new Map<string, number>()

  for (const f of fills) {
    const date = new Date(f.time).toISOString().split('T')[0]
    const pnl = parseFloat(f.closedPnl) - parseFloat(f.fee)
    byDay.set(date, (byDay.get(date) || 0) + pnl)
  }

  const sorted = Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b))
  let cumulative = 0

  return sorted.map(([date, pnl]) => {
    cumulative += pnl
    return { date, pnl: Math.round(pnl * 100) / 100, cumulative: Math.round(cumulative * 100) / 100 }
  })
}

function computeTradeStats(fills: Fill[]): TradeStats {
  if (fills.length === 0) {
    return {
      totalTrades: 0, winRate: 0, avgTradeSizeUsd: 0,
      largestWin: 0, largestLoss: 0, avgHoldTimeSeconds: 0,
      profitFactor: 0, grossProfit: 0, grossLoss: 0,
    }
  }

  let grossProfit = 0
  let grossLoss = 0
  let wins = 0
  let totalSize = 0
  let largestWin = 0
  let largestLoss = 0

  for (const f of fills) {
    const pnl = parseFloat(f.closedPnl)
    const size = parseFloat(f.px) * parseFloat(f.sz)
    totalSize += size

    if (pnl > 0) {
      grossProfit += pnl
      wins++
      if (pnl > largestWin) largestWin = pnl
    } else if (pnl < 0) {
      grossLoss += Math.abs(pnl)
      if (pnl < largestLoss) largestLoss = pnl
    }
  }

  // Estimate hold time by pairing opens and closes per coin
  const openTimes = new Map<string, number[]>()
  const holdTimes: number[] = []

  for (const f of fills) {
    const key = f.coin
    const dir = f.dir
    // "Open Long", "Open Short" = opening; "Close Long", "Close Short" = closing
    if (dir.startsWith('Open')) {
      if (!openTimes.has(key)) openTimes.set(key, [])
      openTimes.get(key)!.push(f.time)
    } else if (dir.startsWith('Close')) {
      const opens = openTimes.get(key)
      if (opens && opens.length > 0) {
        const openTime = opens.shift()!
        holdTimes.push((f.time - openTime) / 1000)
      }
    }
  }

  const avgHold = holdTimes.length > 0
    ? holdTimes.reduce((s, v) => s + v, 0) / holdTimes.length
    : 0

  return {
    totalTrades: fills.length,
    winRate: fills.length > 0 ? wins / fills.length : 0,
    avgTradeSizeUsd: Math.round(totalSize / fills.length),
    largestWin: Math.round(largestWin * 100) / 100,
    largestLoss: Math.round(largestLoss * 100) / 100,
    avgHoldTimeSeconds: Math.round(avgHold),
    profitFactor: grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : grossProfit > 0 ? Infinity : 0,
    grossProfit: Math.round(grossProfit * 100) / 100,
    grossLoss: Math.round(grossLoss * 100) / 100,
  }
}

function computeAssetBreakdown(fills: Fill[]): AssetBreakdown[] {
  const byCoin = new Map<string, { pnl: number; trades: number; volume: number }>()

  for (const f of fills) {
    const coin = f.coin
    const entry = byCoin.get(coin) || { pnl: 0, trades: 0, volume: 0 }
    entry.pnl += parseFloat(f.closedPnl) - parseFloat(f.fee)
    entry.trades++
    entry.volume += parseFloat(f.px) * parseFloat(f.sz)
    byCoin.set(coin, entry)
  }

  return Array.from(byCoin.entries())
    .map(([coin, data]) => ({
      coin,
      pnl: Math.round(data.pnl * 100) / 100,
      trades: data.trades,
      volume: Math.round(data.volume),
    }))
    .sort((a, b) => b.pnl - a.pnl)
}

function computeFundingSummary(fundings: UserFunding[]) {
  let total = 0
  let received = 0
  let paid = 0

  for (const f of fundings) {
    const amt = parseFloat(f.usdc)
    total += amt
    if (amt >= 0) received += amt
    else paid += Math.abs(amt)
  }

  return {
    total: Math.round(total * 100) / 100,
    received: Math.round(received * 100) / 100,
    paid: Math.round(paid * 100) / 100,
    count: fundings.length,
  }
}

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address')
  const daysParam = parseInt(req.nextUrl.searchParams.get('days') || '30')
  const days = VALID_DAYS.includes(daysParam) ? daysParam : 30

  if (!address || !ETH_RE.test(address)) {
    return NextResponse.json({ error: 'Valid address required' }, { status: 400 })
  }

  const startTime = Date.now() - days * 86400000

  try {
    const [fills, fundings] = await Promise.all([
      getUserFills(address.toLowerCase(), startTime),
      getUserFundings(address.toLowerCase(), startTime),
    ])

    const dailyPnl = computeDailyPnl(fills)
    const stats = computeTradeStats(fills)
    const assetBreakdown = computeAssetBreakdown(fills)
    const funding = computeFundingSummary(fundings)

    return NextResponse.json({
      address: address.toLowerCase(),
      days,
      dailyPnl,
      stats,
      assetBreakdown,
      funding,
      fillCount: fills.length,
      fundingCount: fundings.length,
    })
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to fetch performance data', detail: String(err) },
      { status: 500 }
    )
  }
}
