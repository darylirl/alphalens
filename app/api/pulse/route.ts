import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/db/supabase'
import { shapePulseRow, type PulseRow } from '@/lib/pulse/shape'

export const dynamic = 'force-dynamic'

/**
 * GET /api/pulse
 * Aggregate positioning of the tracked cohort over rolling 24h, computed
 * entirely from CAPTURED fills (pulse_24h materialized view, refreshed by
 * pg_cron every 30 minutes) — no live Hyperliquid calls, no per-wallet data,
 * and none of the deprecated wallet confidence scores.
 */
export async function GET() {
  try {
    const supabase = getSupabase()

    const [{ data: rows }, { data: latest }, { data: first }] = await Promise.all([
      supabase
        .from('pulse_24h')
        .select('*')
        .order('notional_24h', { ascending: false })
        .limit(40),
      // service filter: the verification worker also heartbeats into
      // capture_health (service='verify'); capture status must read only the
      // capture daemon's rows.
      supabase.from('capture_health').select('ts,wallets_polled')
        .eq('service', 'capture').order('ts', { ascending: false }).limit(5),
      supabase.from('capture_health').select('ts')
        .eq('service', 'capture').order('ts', { ascending: true }).limit(1),
    ])

    // Shaped by the shared mapper, not inline: the admin console's
    // cohort-signal form derives calls from these same numbers, and two copies
    // of this arithmetic could disagree while both looked authoritative.
    const coins = ((rows || []) as PulseRow[])
      .filter(r => Number(r.notional_24h) > 0)
      .map(shapePulseRow)

    const lastTs = latest?.[0]?.ts ? new Date(latest[0].ts).getTime() : null
    const computedAt = rows?.[0]?.computed_at ?? null

    return NextResponse.json({
      coins,
      coverage: {
        live: lastTs !== null && Date.now() - lastTs < 3 * 60 * 1000,
        captureSince: first?.[0]?.ts ?? null,
        lastHeartbeat: latest?.[0]?.ts ?? null,
        walletsTracked: latest?.find(r => r.wallets_polled != null)?.wallets_polled ?? null,
        computedAt,
      },
    })
  } catch {
    return NextResponse.json({ coins: [], coverage: { live: false, captureSince: null, lastHeartbeat: null, walletsTracked: null, computedAt: null } })
  }
}
