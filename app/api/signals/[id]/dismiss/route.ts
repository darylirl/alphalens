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
 * POST /api/signals/[id]/dismiss
 * Sets a signal's status to 'dismissed'.
 */
export async function POST(
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
      .update({ status: 'dismissed' })
      .eq('signal_id', id)
      .eq('status', 'active')
      .select()
      .single()

    if (error || !data) {
      return envelope(null, 'Signal not found or already dismissed')
    }

    return envelope(data)
  } catch (err) {
    return envelope(null, `Failed to dismiss signal: ${String(err)}`)
  }
}
