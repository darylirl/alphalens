import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/db/supabase'

function envelope(data: unknown, count?: number, error?: string) {
  return NextResponse.json({
    success: !error,
    data: error ? null : data,
    ...(count !== undefined && { count }),
    ...(error && { error }),
  })
}

/**
 * GET /api/signals
 * Returns active, non-expired signals sorted by timestamp descending.
 *
 * Query params:
 *   coin     — filter by market (e.g., BTC)
 *   side     — filter by direction (long/short)
 *   confidence — filter by confidence level (high/medium/low)
 *   limit    — max results (default 20, max 100)
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabase()
    const params = req.nextUrl.searchParams

    const coin = params.get('coin')
    const side = params.get('side')
    const confidence = params.get('confidence')
    const limitParam = parseInt(params.get('limit') || '20')
    const limit = Math.min(Math.max(1, limitParam), 100)

    let query = supabase
      .from('signals')
      .select('*')
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .order('timestamp', { ascending: false })
      .limit(limit)

    if (coin) query = query.eq('coin', coin.toUpperCase())
    if (side && (side === 'long' || side === 'short')) query = query.eq('side', side)
    if (confidence && ['high', 'medium', 'low'].includes(confidence)) query = query.eq('confidence', confidence)

    const { data, error } = await query

    if (error) {
      return envelope(null, undefined, `Database error: ${error.message}`)
    }

    // Also return consensus alerts (3+ wallets in same direction on same coin within 1h)
    const consensus = computeConsensus(data || [])

    return NextResponse.json({
      success: true,
      data: data || [],
      count: data?.length || 0,
      consensus,
    })
  } catch (err) {
    return envelope(null, undefined, `Failed to fetch signals: ${String(err)}`)
  }
}

interface Signal {
  coin: string
  side: string
  wallet_address: string
  notional_usd: number
  confidence: string
  timestamp: string
}

function computeConsensus(signals: Signal[]) {
  // Group by coin+side within last hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const recent = signals.filter(s => s.timestamp >= oneHourAgo)

  const groups = new Map<string, Signal[]>()
  for (const s of recent) {
    const key = `${s.coin}_${s.side}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(s)
  }

  return Array.from(groups.entries())
    .filter(([, sigs]) => sigs.length >= 3)
    .map(([key, sigs]) => {
      const [coin, side] = key.split('_')
      return {
        coin,
        side,
        wallet_count: sigs.length,
        total_notional: sigs.reduce((s, sig) => s + Number(sig.notional_usd), 0),
        avg_confidence: sigs.filter(s => s.confidence === 'high').length / sigs.length >= 0.5 ? 'high' : 'medium',
        wallets: sigs.map(s => s.wallet_address),
      }
    })
}
