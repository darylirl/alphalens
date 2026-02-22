import { NextResponse } from 'next/server'

const HL_URL = 'https://api.hyperliquid.xyz/info'

async function hlPost(payload: Record<string, unknown>) {
  try {
    const res = await fetch(HL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

async function fetchFills(address: string, startTime: number) {
  // Try new endpoint first, fall back to legacy
  const data = await hlPost({ type: 'userFillsByTime', user: address, startTime, aggregateByTime: false })
  if (Array.isArray(data)) return data
  const legacy = await hlPost({ type: 'userFills', user: address })
  if (Array.isArray(legacy)) return legacy
  return []
}

export async function GET(req: Request, { params }: { params: { address: string } }) {
  const { address } = params

  try {
    const startTime = Date.now() - 90 * 24 * 60 * 60 * 1000

    const [state, fills, fundings] = await Promise.all([
      hlPost({ type: 'clearinghouseState', user: address }),
      fetchFills(address, startTime),
      hlPost({ type: 'userFundings', user: address, startTime }).then(
        data => Array.isArray(data) ? data : []
      ),
    ])

    // Even if state is null, return a minimal response so the page can render
    const defaultState = {
      assetPositions: [],
      crossMarginSummary: { accountValue: '0', totalMarginUsed: '0', totalNtlPos: '0', totalRawUsd: '0' },
      marginSummary: { accountValue: '0', totalMarginUsed: '0', totalNtlPos: '0', totalRawUsd: '0' },
      withdrawable: '0'
    }

    return NextResponse.json({
      state: state || defaultState,
      fills,
      fundings,
      address
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch wallet data' }, { status: 502 })
  }
}
