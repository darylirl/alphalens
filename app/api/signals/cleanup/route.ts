import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/db/supabase'

function envelope(data: unknown, error?: string) {
  return NextResponse.json({
    success: !error,
    data: error ? null : data,
    ...(error && { error }),
  })
}

/**
 * GET /api/signals/cleanup
 * Sets all expired signals (expires_at < now) to status 'expired'.
 * Intended to be called by a cron job or manually.
 */
export async function GET() {
  try {
    const supabase = getSupabase()

    const { data, error, count } = await supabase
      .from('signals')
      .update({ status: 'expired' })
      .eq('status', 'active')
      .lt('expires_at', new Date().toISOString())
      .select('signal_id')

    if (error) {
      return envelope(null, `Cleanup failed: ${error.message}`)
    }

    return NextResponse.json({
      success: true,
      data: { expired_count: data?.length || 0 },
      count: data?.length || 0,
    })
  } catch (err) {
    return envelope(null, `Cleanup failed: ${String(err)}`)
  }
}
