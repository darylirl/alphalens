import { NextRequest, NextResponse } from 'next/server'
import { validateAddress } from '@/lib/validation'
import { getSupabase } from '@/lib/db/supabase'
import { isAuthorized, unauthorizedResponse } from '@/lib/auth/admin'

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

export async function GET(req: NextRequest, { params }: { params: { address: string } }) {
  const address = validateAddress(params.address)
  if (!address) {
    return NextResponse.json({ error: 'Invalid Ethereum address format' }, { status: 400 })
  }

  try {
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000

    const [state, portfolio, fundings, fills] = await Promise.all([
      hlPost({ type: 'clearinghouseState', user: address }),
      hlPost({ type: 'portfolio', user: address }),
      hlPost({ type: 'userFunding', user: address, startTime: 1 }).then(
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

const VALID_ARCHETYPES = ['market_maker', 'momentum_trader', 'basis_trader', 'whale', 'scalper', 'swing_trader']

export async function PATCH(req: NextRequest, { params }: { params: { address: string } }) {
  if (!isAuthorized(req)) return unauthorizedResponse()

  const address = validateAddress(params.address)
  if (!address) {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 })
  }

  try {
    const body = await req.json()
    const supabase = getSupabase()
    const updates: Record<string, unknown> = {}

    if ('label' in body) {
      updates.label = body.label ? String(body.label).slice(0, 50) : null
    }

    if ('tags' in body && Array.isArray(body.tags)) {
      updates.tags = body.tags.filter((t: string) => VALID_ARCHETYPES.includes(t))
      updates.manually_tagged = true
    }

    if ('manually_tagged' in body) {
      updates.manually_tagged = Boolean(body.manually_tagged)
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    updates.last_updated = new Date().toISOString()

    let { error } = await supabase
      .from('wallets')
      .update(updates)
      .eq('address', address)

    // Migration 005 may not be applied yet — retry without manually_tagged so
    // label/tag edits still persist, rather than failing the whole update.
    if (error && 'manually_tagged' in updates && error.message.includes('manually_tagged')) {
      delete updates.manually_tagged
      const retry = await supabase
        .from('wallets')
        .update(updates)
        .eq('address', address)
      error = retry.error
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, address, ...updates })
  } catch {
    return NextResponse.json({ error: 'Failed to update wallet' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { address: string } }) {
  if (!isAuthorized(req)) return unauthorizedResponse()

  const address = validateAddress(params.address)
  if (!address) {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 })
  }

  try {
    const supabase = getSupabase()

    const { error } = await supabase
      .from('wallets')
      .update({ removed_at: new Date().toISOString() })
      .eq('address', address)

    if (error) {
      // Fallback: hard delete if removed_at column doesn't exist
      const { error: deleteError } = await supabase
        .from('wallets')
        .delete()
        .eq('address', address)

      if (deleteError) {
        return NextResponse.json({ error: deleteError.message }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true, address })
  } catch {
    return NextResponse.json({ error: 'Failed to remove wallet' }, { status: 500 })
  }
}
