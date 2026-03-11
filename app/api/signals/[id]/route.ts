import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/db/supabase'

function envelope(data: unknown, error?: string) {
  return NextResponse.json({
    success: !error,
    data: error ? null : data,
    ...(error && { error }),
  })
}

/**
 * GET /api/signals/[id]
 * Returns a single signal by signal_id.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = getSupabase()
    const { id } = params

    if (!id) {
      return envelope(null, 'Signal ID is required')
    }

    const { data, error } = await supabase
      .from('signals')
      .select('*')
      .eq('signal_id', id)
      .single()

    if (error || !data) {
      return envelope(null, 'Signal not found')
    }

    return envelope(data)
  } catch (err) {
    return envelope(null, `Failed to fetch signal: ${String(err)}`)
  }
}
