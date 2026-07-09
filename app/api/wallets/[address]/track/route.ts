import { NextResponse } from 'next/server'
import { validateAddress } from '@/lib/validation'

export async function POST(req: Request, { params }: { params: { address: string } }) {
  const address = validateAddress(params.address)
  if (!address) {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 })
  }

  const body = await req.json()

  try {
    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY

    if (supabaseUrl && supabaseKey && supabaseUrl !== 'your_supabase_project_url') {
      const { createClient } = await import('@supabase/supabase-js')
      const supabase = createClient(supabaseUrl, supabaseKey)

      const { error } = await supabase
        .from('watchlists')
        .update({
          wallet_addresses: body.wallet_addresses
        })
        .eq('id', body.watchlist_id)

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, address })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
