// The candle retention ladder, isomorphic (no server imports) so both the
// candles API and the replay player's interval picker reason from the same
// numbers. Mirrors verify-service/lib/market.mjs, the canonical
// implementation: the exchange retains roughly 5000 bars per interval
// (measured: 1m → 3.5 d, 5m → 17.4 d, 15m → 52 d, 1h → 208 d, 4h → 833 d).

export const RETENTION_BARS = 4900 // conservative vs the ~5000 measured

export const CANDLE_INTERVALS: ReadonlyArray<readonly [string, number]> = Object.freeze([
  ['1m', 60_000],
  ['5m', 300_000],
  ['15m', 900_000],
  ['1h', 3_600_000],
  ['4h', 14_400_000],
  ['1d', 86_400_000],
])

export const INTERVAL_MS: Record<string, number> = Object.fromEntries(CANDLE_INTERVALS)

/** Oldest bar the exchange still serves for an interval. */
export function retentionStart(interval: string, now = Date.now()): number {
  return now - RETENTION_BARS * (INTERVAL_MS[interval] ?? Infinity)
}

/** Hard cap on bars per candles response — bounded reads, bounded payloads. */
export const MAX_BARS = 2500

export function barLabel(ms: number): string {
  const sec = ms / 1000
  if (sec >= 86_400) return `${Math.round(sec / 86_400)}d`
  if (sec >= 3_600) return `${Math.round(sec / 3_600)}h`
  if (sec >= 60) return `${Math.round(sec / 60)}m`
  return `${Math.round(sec)}s`
}
