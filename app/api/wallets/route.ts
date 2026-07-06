import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/db/supabase'
import { validateAddress } from '@/lib/validation'
import { isAuthorized, unauthorizedResponse } from '@/lib/auth/admin'

export async function GET() {
  try {
    const supabase = getSupabase()

    const { data, error } = await supabase
      .from('wallets')
      .select('*')
      .is('removed_at', null)
      .order('created_at', { ascending: false })
      .limit(500)

    if (error) {
      // Fallback: try without removed_at filter (column may not exist yet)
      const { data: fallback, error: fallbackError } = await supabase
        .from('wallets')
        .select('*')
        .order('sharpe_30d', { ascending: false })
        .limit(100)

      if (!fallbackError && fallback) return NextResponse.json(fallback)
      return NextResponse.json([])
    }

    return NextResponse.json(data || [])
  } catch {
    return NextResponse.json([])
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return unauthorizedResponse()

  try {
    const body = await req.json()
    const address = validateAddress(body.address)

    if (!address) {
      return NextResponse.json({ error: 'Invalid Ethereum address' }, { status: 400 })
    }

    const label = body.label ? String(body.label).slice(0, 50) : null
    const supabase = getSupabase()

    // Check if wallet already exists (including soft-deleted)
    const { data: existing } = await supabase
      .from('wallets')
      .select('address, removed_at')
      .eq('address', address)
      .single()

    if (existing && !existing.removed_at) {
      return NextResponse.json({ error: 'Wallet already tracked' }, { status: 409 })
    }

    // Verify wallet exists on Hyperliquid
    let isActive = false
    let warning: string | undefined
    try {
      const hlRes = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'clearinghouseState', user: address }),
      })
      if (hlRes.ok) {
        const state = await hlRes.json()
        const accountValue = parseFloat(state?.crossMarginSummary?.accountValue || '0')
        const positions = state?.assetPositions?.length || 0
        isActive = accountValue > 0 || positions > 0
        if (!isActive) {
          warning = 'This wallet has no positions or account value on Hyperliquid. It has been added but may not generate signals.'
        }
      }
    } catch {
      warning = 'Could not verify wallet on Hyperliquid. Added anyway.'
    }

    if (existing?.removed_at) {
      // Re-activate soft-deleted wallet
      const { error } = await supabase
        .from('wallets')
        .update({ removed_at: null, label, last_updated: new Date().toISOString() })
        .eq('address', address)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    } else {
      // Insert new wallet
      const { error } = await supabase
        .from('wallets')
        .insert({
          address,
          label,
          is_seeded: false,
        })

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    }

    // Trigger classification — forward the caller's credentials since the
    // classify endpoint is also behind the admin gate
    let tags: string[] = ['unclassified']
    try {
      const authHeaders: Record<string, string> = {}
      const authHeader = req.headers.get('authorization')
      const cookieHeader = req.headers.get('cookie')
      if (authHeader) authHeaders['authorization'] = authHeader
      if (cookieHeader) authHeaders['cookie'] = cookieHeader

      const classifyRes = await fetch(
        `${req.nextUrl.origin}/api/wallets/classify?address=${address}`,
        { method: 'POST', headers: authHeaders }
      )
      if (classifyRes.ok) {
        const classifyData = await classifyRes.json()
        if (classifyData.data?.results?.[0]?.tags) {
          tags = classifyData.data.results[0].tags
        }
      }
    } catch {
      // Classification failed silently
    }

    return NextResponse.json({
      success: true,
      address,
      label,
      tags,
      isActive,
      warning,
    })
  } catch {
    return NextResponse.json({ error: 'Failed to add wallet' }, { status: 500 })
  }
}
