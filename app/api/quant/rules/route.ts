import { NextResponse } from 'next/server'
import { sanitizeString } from '@/lib/validation'

export async function GET() {
  try {
    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY

    if (supabaseUrl && supabaseKey && supabaseUrl !== 'your_supabase_project_url') {
      const { createClient } = await import('@supabase/supabase-js')
      const supabase = createClient(supabaseUrl, supabaseKey)

      const { data, error } = await supabase
        .from('quant_rules')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)

      if (!error && data) return NextResponse.json(data)
    }

    return NextResponse.json([])
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()

    // Validate required fields
    const name = sanitizeString(body.name, 200)
    if (!name) {
      return NextResponse.json({ error: 'Rule name is required' }, { status: 400 })
    }

    const userId = sanitizeString(body.userId || 'anonymous', 100)
    const rule = body.rule

    // Validate rule_json is a plain object (prevent prototype pollution)
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      return NextResponse.json({ error: 'Invalid rule format' }, { status: 400 })
    }

    // Limit rule JSON size to prevent abuse
    const ruleStr = JSON.stringify(rule)
    if (ruleStr.length > 50000) {
      return NextResponse.json({ error: 'Rule too large (max 50KB)' }, { status: 400 })
    }

    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY

    if (supabaseUrl && supabaseKey && supabaseUrl !== 'your_supabase_project_url') {
      const { createClient } = await import('@supabase/supabase-js')
      const supabase = createClient(supabaseUrl, supabaseKey)

      const { data, error } = await supabase
        .from('quant_rules')
        .insert({
          user_id: userId,
          name,
          rule_json: rule,
          is_active: true
        })
        .select()
        .single()

      if (error) return NextResponse.json({ error: 'Failed to save rule' }, { status: 500 })
      return NextResponse.json(data)
    }

    return NextResponse.json({ id: crypto.randomUUID(), name, rule })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
