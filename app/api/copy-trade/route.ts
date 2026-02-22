import { NextResponse } from 'next/server'

// GET: Retrieve copy trade configurations for a user
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const user = searchParams.get('user')

  if (!user) {
    return NextResponse.json({ error: 'User address required' }, { status: 400 })
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
      .eq('user_address', user.toLowerCase())

    return NextResponse.json({ configs: data || [] })
  } catch {
    return NextResponse.json({ configs: [] })
  }
}

// POST: Create or update a copy trade configuration
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { userAddress, targetAddress, ratio, maxPositionSize, enabled } = body

    if (!userAddress || !targetAddress) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

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
        user_address: userAddress.toLowerCase(),
        target_address: targetAddress.toLowerCase(),
        ratio: ratio || 100,
        max_position_size: maxPositionSize || 10000,
        enabled: enabled ?? true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_address,target_address' })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, data })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
