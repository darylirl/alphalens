// Compact figures for the replay surfaces — shared by the live player and
// the export frame painter so a clip cannot format a number differently from
// the page it was recorded from.

export function usdCompact(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e9) return `$${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e4) return `$${(abs / 1e3).toFixed(1)}K`
  if (abs >= 1e3) return `$${(abs / 1e3).toFixed(2)}K`
  if (abs >= 1) return `$${abs.toFixed(abs >= 100 ? 0 : 2)}`
  return `$${abs.toFixed(4)}`
}

export function signedUsd(n: number): string {
  return `${n >= 0 ? '+' : '−'}${usdCompact(Math.abs(n))}`
}

/** A moment, short and in UTC — the chart's own timebase. */
export function stamp(ms: number): string {
  return new Date(ms).toISOString().slice(5, 16).replace('T', ' ') + 'Z'
}

export function dayStamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function priceLabel(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 10_000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 })
  if (abs >= 100) return v.toFixed(1)
  if (abs >= 1) return v.toFixed(3)
  if (abs >= 0.01) return v.toFixed(5)
  return v.toPrecision(3)
}

export function durationLabel(ms: number): string {
  const sec = ms / 1000
  if (sec >= 86_400) return `${(sec / 86_400).toFixed(1)}d`
  if (sec >= 3_600) return `${(sec / 3_600).toFixed(1)}h`
  if (sec >= 60) return `${Math.round(sec / 60)}m`
  return `${Math.round(sec)}s`
}
