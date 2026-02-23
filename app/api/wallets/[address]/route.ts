import { NextResponse } from 'next/server'
import { validateAddress } from '@/lib/validation'

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
  const allFills: Array<Record<string, unknown>> = []
  let cursor = startTime
  const MAX_PAGES = 50 // safety limit

  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await hlPost({ type: 'userFillsByTime', user: address, startTime: cursor, aggregateByTime: false })
    if (!Array.isArray(data) || data.length === 0) break

    allFills.push(...data)

    // If fewer than ~2000 results, we've reached the end
    if (data.length < 2000) break

    // Paginate: use the last fill's timestamp + 1ms as next startTime
    const lastTime = (data[data.length - 1] as { time: number }).time
    if (lastTime <= cursor) break // no progress, avoid infinite loop
    cursor = lastTime + 1
  }

  if (allFills.length > 0) return allFills

  // Fallback to legacy endpoint if new endpoint returned nothing
  const legacy = await hlPost({ type: 'userFills', user: address })
  if (Array.isArray(legacy)) return legacy
  return []
}

export async function GET(req: Request, { params }: { params: { address: string } }) {
  const address = validateAddress(params.address)
  if (!address) {
    return NextResponse.json({ error: 'Invalid Ethereum address format' }, { status: 400 })
  }

  try {
    // Fetch all-time data from wallet creation (Hyperliquid launched late 2023)
    const startTime = new Date('2023-01-01').getTime()

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
