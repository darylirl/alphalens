import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/db/supabase'

export const dynamic = 'force-dynamic'

/**
 * GET /api/pulse
 * Aggregate positioning of the tracked cohort over rolling 24h, computed
 * entirely from CAPTURED fills (pulse_24h materialized view, refreshed by
 * pg_cron every 30 minutes) — no live Hyperliquid calls, no per-wallet data,
 * and none of the deprecated wallet confidence scores.
 */
/**
 * Per-direction concentration, or null when the view cannot answer.
 *
 * Migration 024 added these columns; a deployment whose matview predates it
 * returns rows without them. That is "not measured", and it is reported as
 * null rather than as zeros — a 0% top-wallet share is the most permissive
 * answer there is, and inventing it for an unmeasured coin would hand the
 * cohort_signal floor a pass it never earned. cohortSignalCall() refuses on
 * null, so the whole path fails closed until the migration is applied.
 *
 * Aggregates only: a share of a total and a count of participants. No wallet
 * is named here, and the view does not carry one to name.
 */
function concentrationBlock(r: Record<string, unknown>) {
  const side = (notional: unknown, wallets: unknown, top: unknown) => {
    const n = Number(notional)
    const w = Number(wallets)
    const t = Number(top)
    if (!Number.isFinite(n) || !Number.isFinite(w) || !Number.isFinite(t)) return null
    return {
      notionalUsd: Math.round(n),
      wallets: w,
      topWalletNotionalUsd: Math.round(t),
      topWalletSharePct: n > 0 ? Number(((t / n) * 100).toFixed(2)) : null,
    }
  }
  const long = side(r.long_notional_24h, r.long_wallets_24h, r.top_long_wallet_notional_24h)
  const short = side(r.short_notional_24h, r.short_wallets_24h, r.top_short_wallet_notional_24h)
  if (!long || !short) return null
  return { long, short }
}

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
          concentration: concentrationBlock(r),
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
        walletsTracked: latest?.find(r => r.wallets_polled != null)?.wallets_polled ?? null,
        computedAt,
      },
    })
  } catch {
    return NextResponse.json({ coins: [], coverage: { live: false, captureSince: null, lastHeartbeat: null, walletsTracked: null, computedAt: null } })
  }
}
