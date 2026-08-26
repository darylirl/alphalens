/**
 * The replay document (replay-doc.v1): a compact, serialized, build-once
 * playback unit for one (wallet, coin, range, bar width). Everything the
 * player needs to roll — coarsened candles, trade events, running position
 * and realized-PnL series, the coin's episode index — in arrays-of-arrays,
 * so a cached doc streams and parses fast.
 *
 * Isomorphic on purpose: the server builder encodes with these helpers and
 * the player decodes with them, so the two cannot drift. No invented data
 * anywhere — every array element traces to a real fill or a real candle, and
 * the coverage block travels inside the doc.
 */

import type { RCandle, RFill } from './engine'
import type { Episode } from './episodes'

export const REPLAY_DOC_SCHEMA = 'replay-doc.v1' as const

/** Hard cap on bars per doc — coarsened server-side before serialization,
 *  never shipped finer than needed. (Auto-pacing targets 75–150 bars, and
 *  the candles ladder already refuses >2500-bar windows; this is the doc
 *  format's own outer bound.) */
export const DOC_MAX_BARS = 4000

/** The pre-builder refreshes a cohort doc once this many fills (in its
 *  scope) landed after its build. Mirrored in verify-service/prebuild.mjs. */
export const REFRESH_FILL_THRESHOLD = 25

/** Viewers are served a cached cohort doc with its fill-lag DECLARED
 *  (x-replay-fills-behind + the on-page note) up to this ceiling; past it
 *  the view rebuilds synchronously. The two thresholds are deliberately far
 *  apart: the most active cohort wallets print ~25 fills in under two
 *  minutes, so rebuilding on the refresh threshold would make every view
 *  cold and defeat the cache — an episode that already closed is unchanged
 *  by new fills, and a declared lag is honest where a silent one is not. */
export const SERVE_STALE_MAX_FILLS = 1000

/** Non-cohort (pasted) wallets read the exchange's sliding recent window, so
 *  their docs expire by time instead of by our capture stream. */
export const PASTED_TTL_MS = 15 * 60_000

// ── Ranges ──────────────────────────────────────────────────────────────────

export type DocRange = 'default' | 'all' | { from: number; to: number }

export function rangeKey(r: DocRange): string {
  if (r === 'default' || r === 'all') return r
  return `ep:${r.from}-${r.to}`
}

export function parseRangeKey(s: string): DocRange | null {
  if (s === 'default' || s === 'all') return s
  const m = /^ep:(\d+)-(\d+)$/.exec(s)
  if (!m) return null
  const from = Number(m[1])
  const to = Number(m[2])
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) return null
  return { from, to }
}

// ── Wire tuples (arrays-of-arrays, not verbose objects) ─────────────────────

/** [t, o, h, l, c, v] */
export type WireCandle = [number, number, number, number, number, number]

/** [t, px, sz, sideB(1=B/0=A), usd, pnl, fee, start|null, dirIdx] — one real
 *  fill; usd is |px*sz| notional; dirIdx indexes the doc's `dirs` table. */
export type WireFill = [
  number,
  number,
  number,
  0 | 1,
  number,
  number,
  number,
  number | null,
  number,
]

/** [from, to, pnl, fees, entries, exits, fills, maxPosCoins, maxPosUsd,
 *  openBeforeCoverage(0/1), openAtEnd(0/1)] */
export type WireEpisode = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  0 | 1,
  0 | 1,
]

/** [coin, fillCount, from, to, episodeCount, topPnl|null, topPartial(0/1)] */
export type WireCoin = [string, number, number, number, number, number | null, 0 | 1]

/** An episode as the player consumes it — the detector's Episode minus the
 *  fill indices (meaningless once serialized apart from the fills array). */
export type DocEpisode = Omit<Episode, 'firstFill' | 'lastFill'>

export interface DocIntervalOption {
  interval: string
  interval_ms: number
  available: boolean
  source: 'exchange' | 'store' | null
  reason: string | null
}

export interface ReplayDoc {
  v: 1
  schema: typeof REPLAY_DOC_SCHEMA
  address: string
  /** The request as made (coin '' = "pick for me"). */
  requested: { coin: string; range: string; interval: string }
  /** What the server resolved it to — a concrete coin, range and bar width. */
  resolved: {
    coin: string
    range: string
    from: number
    to: number
    padFrom: number
    padTo: number
    interval: string
    interval_ms: number
    /** >1 when the server merged bars to stay under DOC_MAX_BARS. */
    coarsen: number
  } | null
  identity: { label: string | null; archetype: string | null; cohort_member: boolean }
  built_at: string
  /** Newest fill timestamp included (doc scope), ISO; null when none. */
  built_through: string | null
  fill_count_total: number
  starts_mid_position: boolean
  gap_coins: string[]
  coverage: {
    fills: {
      source: 'store' | 'exchange'
      from: string | null
      to: string | null
      fill_count: number
      capped: boolean
      note: string
    }
    candles: {
      source: 'exchange' | 'store'
      bars: number
      window_bars: number
      internal_gaps: number
      largest_internal_gap_ms: number
      note: string
    } | null
  }
  /** Cross-coin summary for the pickers. Only the default doc (requested
   *  coin '') carries it; coin-scoped docs ship null and the player keeps
   *  the list it already has. */
  coins: WireCoin[] | null
  /** Episode index for the resolved coin, in detection (time) order. */
  episodes: WireEpisode[]
  intervals: DocIntervalOption[]
  candles: WireCandle[]
  /** String table for fill directions ("Open Long", "Close Short", …). */
  dirs: string[]
  fills: WireFill[]
  /** Per-bar running series, same length as candles: realized PnL after each
   *  bar (exchange closedPnl sums), position in coins after each bar, and
   *  cumulative fill count. */
  series: { realized: number[]; pos: number[]; fills_after: number[] }
}

// ── Encode (server) ─────────────────────────────────────────────────────────

export function encodeCandles(candles: RCandle[]): WireCandle[] {
  return candles.map(c => [c.t, c.o, c.h, c.l, c.c, c.v])
}

export function encodeFills(fills: RFill[], dirs: string[]): WireFill[] {
  const dirIdx = new Map<string, number>(dirs.map((d, i) => [d, i]))
  return fills.map(f => {
    let di = dirIdx.get(f.dir)
    if (di === undefined) {
      di = dirs.length
      dirs.push(f.dir)
      dirIdx.set(f.dir, di)
    }
    return [
      f.t,
      f.px,
      f.sz,
      f.side === 'B' ? 1 : 0,
      Math.abs(f.px * f.sz),
      f.pnl,
      f.fee,
      f.start,
      di,
    ] as WireFill
  })
}

export function encodeEpisodes(episodes: Episode[]): WireEpisode[] {
  return episodes.map(e => [
    e.from,
    e.to,
    e.pnl,
    e.fees,
    e.entries,
    e.exits,
    e.fills,
    e.maxPosCoins,
    e.maxPosUsd,
    e.openBeforeCoverage ? 1 : 0,
    e.openAtEnd ? 1 : 0,
  ])
}

// ── Decode (player) ─────────────────────────────────────────────────────────

export function decodeCandles(wire: WireCandle[]): RCandle[] {
  return wire.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
}

export function decodeFills(wire: WireFill[], dirs: string[]): RFill[] {
  return wire.map(([t, px, sz, sideB, , pnl, fee, start, dirIdx]) => ({
    t,
    px,
    sz,
    side: sideB === 1 ? ('B' as const) : ('A' as const),
    dir: dirs[dirIdx] ?? '',
    pnl,
    fee,
    start,
  }))
}

export function decodeEpisodes(wire: WireEpisode[]): DocEpisode[] {
  return wire.map(
    ([from, to, pnl, fees, entries, exits, fills, maxPosCoins, maxPosUsd, before, atEnd]) => ({
      from,
      to,
      pnl,
      fees,
      entries,
      exits,
      fills,
      maxPosCoins,
      maxPosUsd,
      openBeforeCoverage: before === 1,
      openAtEnd: atEnd === 1,
    })
  )
}
