import { NextResponse } from 'next/server'
import { validateAddress, safeParseFloat } from '@/lib/validation'

// GET: Retrieve copy trade configurations for a user
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const user = validateAddress(searchParams.get('user'))

  if (!user) {
    return NextResponse.json({ error: 'Valid Ethereum address required (0x + 40 hex chars)' }, { status: 400 })
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey || supabaseUrl.includes('your_')) {
    return NextResponse.json({ configs: [] })
  }

  try {
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data } = await supabase
      .from('copy_trade_configs')
      .select('*')
      .eq('user_address', user)

    return NextResponse.json({ configs: data || [] })
  } catch {
    return NextResponse.json({ configs: [] })
  }
}

// POST: Create or update a copy trade configuration
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const userAddr = validateAddress(body.userAddress)
    const targetAddr = validateAddress(body.targetAddress)

    if (!userAddr || !targetAddr) {
      return NextResponse.json({ error: 'Valid Ethereum addresses required (0x + 40 hex chars)' }, { status: 400 })
    }

    if (userAddr === targetAddr) {
      return NextResponse.json({ error: 'Cannot copy trade yourself' }, { status: 400 })
    }

    // Validate numeric params with bounds
    const ratio = safeParseFloat(String(body.ratio ?? ''), 100, 1, 1000)
    const maxPositionSize = safeParseFloat(String(body.maxPositionSize ?? ''), 10000, 1, 10000000)
    const enabled = typeof body.enabled === 'boolean' ? body.enabled : true

    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseKey || supabaseUrl.includes('your_')) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 400 })
    }

    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data, error } = await supabase
      .from('copy_trade_configs')
      .upsert({
        user_address: userAddr,
        target_address: targetAddr,
        ratio,
        max_position_size: maxPositionSize,
        enabled,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_address,target_address' })

    if (error) {
      return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 })
    }

    return NextResponse.json({ success: true, data })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
