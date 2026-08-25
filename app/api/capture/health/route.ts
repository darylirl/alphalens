import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/db/supabase'

export const dynamic = 'force-dynamic'

/**
 * GET /api/capture/health
 * Live status of the forward-capture daemon, read from capture_health
 * heartbeats. Powers honest "capture running" indicators — no fabrication:
 * when the daemon is down, this says so.
 */
export async function GET() {
  try {
    const supabase = getSupabase()

    // service filter: the verification worker also heartbeats into
    // capture_health (service='verify', no WS state); capture status must
    // read only the capture daemon's rows.
    const [{ data: latest }, { data: first }] = await Promise.all([
      supabase.from('capture_health').select('*')
        .eq('service', 'capture').order('ts', { ascending: false }).limit(1),
      supabase.from('capture_health').select('ts')
        .eq('service', 'capture').order('ts', { ascending: true }).limit(1),
    ])

    const last = latest?.[0] ?? null
    const since = first?.[0]?.ts ?? null
    const lastTs = last ? new Date(last.ts).getTime() : null
    // Heartbeats are per-minute; > 3 minutes silent = not live.
    const live = lastTs !== null && Date.now() - lastTs < 3 * 60 * 1000

    return NextResponse.json({
      live,
      lastHeartbeat: last?.ts ?? null,
      captureSince: since,
      wsConnected: last?.ws_connected ?? null,
      walletsTracked: last?.wallets_polled ?? null,
      walletsWs: last?.wallets_ws ?? null,
      coinsTracked: last?.coins_tracked ?? null,
    })
  } catch {
    return NextResponse.json({
      live: false, lastHeartbeat: null, captureSince: null,
      wsConnected: null, walletsTracked: null, walletsWs: null, coinsTracked: null,
    })
  }
}
