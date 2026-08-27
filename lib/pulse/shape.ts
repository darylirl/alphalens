/**
 * The one place a `pulse_24h` row becomes the shape `/api/pulse` serves.
 *
 * Extracted so the admin console's cohort-signal form can derive a call from
 * the SAME numbers the public page shows, without a second copy of the
 * arithmetic. A form that computed `longPct` slightly differently from the
 * page would let someone publish a call whose stated basis does not match the
 * snapshot anyone can read — the numbers would disagree and both would look
 * authoritative.
 */

/** A row of the `pulse_24h` materialized view, as PostgREST returns it. */
export interface PulseRow {
  coin: string
  notional_24h: number | string
  net_flow_24h: number | string
  new_longs_24h: number | string
  new_shorts_24h: number | string
  new_notional_24h: number | string
  add_notional_24h: number | string
  wallets_24h: number | string
  notional_prev: number | string
  net_flow_prev: number | string
  computed_at?: string | null
}

export interface PulseCoin {
  coin: string
  notionalUsd: number
  netFlowUsd: number
  longPct: number
  longPctChange: number | null
  notionalChangePct: number | null
  newLongs: number
  newShorts: number
  newNotionalUsd: number
  addNotionalUsd: number
  activeWallets: number
}

/**
 * Share of notional directed long, as a percentage. Net flow runs from
 * -notional (all short) to +notional (all long), so the midpoint is 50.
 */
function longShare(notional: number, netFlow: number): number {
  return Math.round(((notional + netFlow) / (2 * notional)) * 100)
}

export function shapePulseRow(r: PulseRow): PulseCoin {
  const notional = Number(r.notional_24h)
  const netFlow = Number(r.net_flow_24h)
  const longPct = notional > 0 ? longShare(notional, netFlow) : 50

  const notionalPrev = Number(r.notional_prev)
  const netFlowPrev = Number(r.net_flow_prev)
  // A prior window with no notional is not a 50/50 prior window — it is no
  // measurement at all, so the change is null rather than a number.
  const longPctPrev = notionalPrev > 0 ? longShare(notionalPrev, netFlowPrev) : null

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
}
