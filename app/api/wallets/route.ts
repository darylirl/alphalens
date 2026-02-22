import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_ANON_KEY

    if (supabaseUrl && supabaseKey && supabaseUrl !== 'your_supabase_project_url') {
      const { createClient } = await import('@supabase/supabase-js')
      const supabase = createClient(supabaseUrl, supabaseKey)

      const { data, error } = await supabase
        .from('wallets')
        .select('*')
        .order('sharpe_30d', { ascending: false })
        .limit(100)

      if (!error && data) return NextResponse.json(data)
    }

    return NextResponse.json([])
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
