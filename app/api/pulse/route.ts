import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/db/supabase'

export const dynamic = 'force-dynamic'

/**
 * GET /api/pulse
 * Aggregate positioning of the tracked cohort over rolling 24h, computed
 * entirely from CAPTURED fills (pulse_24h materialized view, refreshed by
 * pg_cron every 5 minutes) — no live Hyperliquid calls, no per-wallet data,
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
      supabase.from('capture_health').select('ts,wallets_polled').order('ts', { ascending: false }).limit(1),
      supabase.from('capture_health').select('ts').order('ts', { ascending: true }).limit(1),
    ])

    const coins = (rows || [])
      .filter(r => Number(r.notional_24h) > 0)
      .map(r => {
        const notional = Number(r.notional_24h)
        const netFlow = Number(r.net_flow_24h)
        const longPct = notional > 0 ? Math.round(((notional + netFlow) / (2 * notional)) * 100) : 50
        const notionalPrev = Number(r.notional_prev)
        const netFlowPrev = Number(r.net_flow_prev)
        const longPctPrev = notionalPrev > 0
          ? Math.round(((notionalPrev + netFlowPrev) / (2 * notionalPrev)) * 100)
          : null
        return {
          coin: r.coin,
          notionalUsd: Math.round(notional),
          netFlowUsd: Math.round(netFlow),
          longPct: Math.min(100, Math.max(0, longPct)),
          longPctChange: longPctPrev !== null ? longPct - longPctPrev : null,
          notionalChangePct: notionalPrev > 0
            ? Math.round(((notional - notionalPrev) / notionalPrev) * 100)
            : null,
          newLongs: Number(r.new_longs_24h),
          newShorts: Number(r.new_shorts_24h),
          newNotionalUsd: Math.round(Number(r.new_notional_24h)),
          addNotionalUsd: Math.round(Number(r.add_notional_24h)),
          activeWallets: Number(r.wallets_24h),
        }
      })

    const lastTs = latest?.[0]?.ts ? new Date(latest[0].ts).getTime() : null
    const computedAt = rows?.[0]?.computed_at ?? null

    return NextResponse.json({
      coins,
      coverage: {
        live: lastTs !== null && Date.now() - lastTs < 3 * 60 * 1000,
        captureSince: first?.[0]?.ts ?? null,
        lastHeartbeat: latest?.[0]?.ts ?? null,
        walletsTracked: latest?.[0]?.wallets_polled ?? null,
        computedAt,
      },
    })
  } catch {
    return NextResponse.json({ coins: [], coverage: { live: false, captureSince: null, lastHeartbeat: null, walletsTracked: null, computedAt: null } })
  }
}
