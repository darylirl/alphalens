import { NextRequest, NextResponse } from 'next/server'
import { getCandleSnapshot, getMetaAndAssetCtxs } from '@/lib/hyperliquid/client'

// GET: return list of active perp markets
export async function GET() {
  try {
    const [meta] = await getMetaAndAssetCtxs()
    const markets = meta.universe.map(m => m.name).sort()
    return NextResponse.json({ markets })
  } catch {
    // Fallback to common markets
    return NextResponse.json({
      markets: ['BTC', 'ETH', 'SOL', 'HYPE', 'SUI', 'ARB', 'DOGE', 'WIF', 'PEPE', 'AVAX', 'LINK', 'OP']
    })
  }
}

// POST: fetch candle data for backtest
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { coin, startTime, endTime, interval } = body

    if (!coin || !startTime || !endTime) {
      return NextResponse.json({ error: 'coin, startTime, endTime required' }, { status: 400 })
    }

    const intv = interval || '1h'
    const start = Number(startTime)
    const end = Number(endTime)

    // Fetch candles in chunks (Hyperliquid may limit per request)
    // 1h candles: ~720 per 30 days, ~2160 per 90 days
    const CHUNK_MS = 30 * 24 * 60 * 60 * 1000 // 30 days per chunk
    const allCandles = []
    let cursor = start

    while (cursor < end) {
      const chunkEnd = Math.min(cursor + CHUNK_MS, end)
      const candles = await getCandleSnapshot(coin, intv, cursor, chunkEnd)
      if (Array.isArray(candles)) {
        allCandles.push(...candles)
      }
      cursor = chunkEnd
      // Small delay between chunks to avoid rate limiting
      if (cursor < end) {
        await new Promise(r => setTimeout(r, 200))
      }
    }

    // Deduplicate by open time and sort
    const seen = new Set<number>()
    const unique = allCandles.filter(c => {
      const t = Number(c.t)
      if (seen.has(t)) return false
      seen.add(t)
      return true
    }).sort((a, b) => Number(a.t) - Number(b.t))

    // Convert string values to numbers for client-side processing
    const parsed = unique.map(c => ({
      t: Number(c.t),
      T: Number(c.T),
      o: parseFloat(c.o as string),
      h: parseFloat(c.h as string),
      l: parseFloat(c.l as string),
      c: parseFloat(c.c as string),
      v: parseFloat(c.v as string),
    }))

    return NextResponse.json({ candles: parsed, count: parsed.length })
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to fetch candle data', detail: String(err) },
      { status: 500 }
    )
  }
}
