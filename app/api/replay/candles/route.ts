import { NextRequest, NextResponse } from 'next/server'
import { loadCandles, INTERVAL_MS } from '@/lib/wallet-data/candles'
import { schemaJson, CORS_HEADERS } from '@/lib/ledger/api'

// Candles for the replay chart. The interval must be one the window can be
// honestly served at — from the exchange's retention ladder or our captured
// 1m tape — and an interval that cannot reach the window is refused with the
// reason, never resampled. The response's `intervals` array reports, for
// this exact window, which intervals are honest and why the others are not.

export const dynamic = 'force-dynamic'

const REPLAY_SCHEMA = 'replay.v0'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const coin = q.get('coin')
  const interval = q.get('interval')
  const from = Number(q.get('from'))
  const to = Number(q.get('to'))

  if (!coin || !/^[A-Za-z0-9@:_.-]{1,32}$/.test(coin)) {
    return NextResponse.json({ error: 'Pass ?coin=' }, { status: 400, headers: CORS_HEADERS })
  }
  if (!interval || !INTERVAL_MS[interval]) {
    return NextResponse.json(
      { error: `Pass ?interval= one of ${Object.keys(INTERVAL_MS).join(', ')}` },
      { status: 400, headers: CORS_HEADERS }
    )
  }
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    return NextResponse.json(
      { error: 'Pass ?from= and ?to= as epoch milliseconds with from < to' },
      { status: 400, headers: CORS_HEADERS }
    )
  }

  try {
    const result = await loadCandles(coin, interval, from, to)
    return schemaJson(REPLAY_SCHEMA, result as unknown as Record<string, unknown>)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'could not load candles'
    // Refusals (interval cannot honestly serve the window, bar cap) are 400s
    // with the reason; a source that did not answer is a 503.
    const refusal = /cap|honestly|resample|window|unknown interval/i.test(message)
    return NextResponse.json(
      { error: message },
      { status: refusal ? 400 : 503, headers: CORS_HEADERS }
    )
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}
