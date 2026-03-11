import { NextResponse } from 'next/server'
import { validateAddress } from '@/lib/validation'
import { getSupabase } from '@/lib/db/supabase'

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

export async function GET(req: Request, { params }: { params: { address: string } }) {
  const address = validateAddress(params.address)
  if (!address) {
    return NextResponse.json({ error: 'Invalid Ethereum address format' }, { status: 400 })
  }

  try {
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000

    const [state, portfolio, fundings, fills] = await Promise.all([
      hlPost({ type: 'clearinghouseState', user: address }),
      hlPost({ type: 'portfolio', user: address }),
      hlPost({ type: 'userFundings', user: address, startTime: 1 }).then(
        data => Array.isArray(data) ? data : []
      ),
      hlPost({ type: 'userFillsByTime', user: address, startTime: ninetyDaysAgo }).then(
        data => Array.isArray(data) ? data : []
      ),
    ])

    const defaultState = {
      assetPositions: [],
      crossMarginSummary: { accountValue: '0', totalMarginUsed: '0', totalNtlPos: '0', totalRawUsd: '0' },
      marginSummary: { accountValue: '0', totalMarginUsed: '0', totalNtlPos: '0', totalRawUsd: '0' },
      withdrawable: '0'
    }

    // Fetch tags from Supabase
    let tags: string[] = []
    try {
      const supabase = getSupabase()
      const { data: walletRow } = await supabase
        .from('wallets')
        .select('tags')
        .eq('address', address.toLowerCase())
        .single()
      tags = walletRow?.tags || []
    } catch { /* Supabase unavailable */ }

    return NextResponse.json({
      state: state || defaultState,
      portfolio: Array.isArray(portfolio) ? portfolio : [],
      fundings,
      fills,
      address,
      tags,
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch wallet data' }, { status: 502 })
  }
}
