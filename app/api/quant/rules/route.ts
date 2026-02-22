import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_ANON_KEY

    if (supabaseUrl && supabaseKey && supabaseUrl !== 'your_supabase_project_url') {
      const { createClient } = await import('@supabase/supabase-js')
      const supabase = createClient(supabaseUrl, supabaseKey)

      const { data, error } = await supabase
        .from('quant_rules')
        .select('*')
        .order('created_at', { ascending: false })

      if (!error && data) return NextResponse.json(data)
    }

    return NextResponse.json([])
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const body = await req.json()

  try {
    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_ANON_KEY

    if (supabaseUrl && supabaseKey && supabaseUrl !== 'your_supabase_project_url') {
      const { createClient } = await import('@supabase/supabase-js')
      const supabase = createClient(supabaseUrl, supabaseKey)

      const { data, error } = await supabase
        .from('quant_rules')
        .insert({
          user_id: body.userId || 'anonymous',
          name: body.name,
          rule_json: body.rule,
          is_active: true
        })
        .select()
        .single()

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json(data)
    }

    return NextResponse.json({ id: crypto.randomUUID(), ...body })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
