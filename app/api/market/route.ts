import { NextResponse } from 'next/server'

const HL_URL = 'https://api.hyperliquid.xyz/info'

export async function GET() {
  try {
    const res = await fetch(HL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
    })

    if (!res.ok) {
      return NextResponse.json({ error: 'Hyperliquid API error' }, { status: 502 })
    }

    const data = await res.json()

    // data is [meta, assetCtxs[]]
    const meta = Array.isArray(data) ? data[0] : data?.meta
    const ctxs = Array.isArray(data) ? data[1] : data?.assetCtxs
    const universe = meta?.universe || []
    const assetCtxs = Array.isArray(ctxs) ? ctxs : []

    let totalVolume = 0
    let openInterest = 0
    let topGainer = ''
    let topGainerPct = 0
    const gainers: Array<{ name: string; change: number; price: number; volume: number }> = []

    assetCtxs.forEach((ctx: Record<string, string>, i: number) => {
      const vol = parseFloat(ctx.dayNtlVlm || '0')
      const markPx = parseFloat(ctx.markPx || '0')
      const oi = parseFloat(ctx.openInterest || '0') * markPx
      const prevPx = parseFloat(ctx.prevDayPx || '0')

      totalVolume += vol
      openInterest += oi

      if (prevPx > 0) {
        const change = ((markPx - prevPx) / prevPx) * 100
        const name = universe[i]?.name || `Asset ${i}`
        gainers.push({ name, change: Math.round(change * 100) / 100, price: markPx, volume: vol })
        if (change > topGainerPct) {
          topGainerPct = change
          topGainer = name
        }
      }
    })

    gainers.sort((a, b) => b.change - a.change)

    return NextResponse.json({
      totalVolume: Math.round(totalVolume),
      openInterest: Math.round(openInterest),
      topGainer,
      topGainerPct: Math.round(topGainerPct * 100) / 100,
      topGainers: gainers.slice(0, 10),
      totalAssets: universe.length,
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch market data' }, { status: 502 })
  }
}
