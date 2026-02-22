import { NextResponse } from 'next/server'

const HL_URL = 'https://api.hyperliquid.xyz/info'

export async function GET(req: Request, { params }: { params: { address: string } }) {
  const { address } = params

  try {
    const [stateRes, fillsRes, fundingsRes] = await Promise.all([
      fetch(HL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'clearinghouseState', user: address })
      }),
      fetch(HL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'userFills', user: address })
      }),
      fetch(HL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'userFundings', user: address })
      })
    ])

    const [state, fills, fundings] = await Promise.all([
      stateRes.json(),
      fillsRes.json(),
      fundingsRes.json()
    ])

    const result = { state, fills, fundings, address }
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch wallet data' }, { status: 502 })
  }
}
