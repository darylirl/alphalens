/**
 * The replay document (replay-doc.v3): a compact, serialized, build-once
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

import type { PlayFill, RCandle } from './engine'
import type { Episode } from './episodes'
import type { SeriesGap } from '@/lib/wallet-data/gaps'

/** v3 adds the fills-gap block (`coin_gaps`) and the two gap flags on every
 *  wire episode. Neither older shape can carry them, and a doc without them,
 *  served for a wallet WITH a proven gap, draws a continuous story across
 *  time nobody measured — so the doc route rebuilds an older document rather
 *  than serving it (with one carve-out, documented there). */
export const REPLAY_DOC_SCHEMA = 'replay-doc.v3' as const

/** The columnar shape v2 documents carry: real fills, no gap block. */
export const REPLAY_DOC_SCHEMA_V2 = 'replay-doc.v2' as const

/** The shape v1 documents carry. Cached v1 rows are honest and keep being
 *  served, so the decoder reads both; only the builder is v2-only. */
export const REPLAY_DOC_SCHEMA_V1 = 'replay-doc.v1' as const

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

/** replay-doc.v1 fills: [t, px, sz, sideB(1=B/0=A), usd, pnl, fee, start|null,
 *  dirIdx], one array per fill. Superseded by WireFills (v2) but still
 *  DECODED, because cached v1 documents are honest and stay servable. */
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

/**
 * replay-doc.v2 fills: the same real fills, columnar and losslessly packed.
 *
 * Measured on a production document: 11,170 fills were 752 KB of a 762 KB
 * document — 98.7% of it, and the whole of the warm-serve cost, which tracks
 * document size. This format is 199 KB raw / 71 KB on the wire for the same
 * fills, and every value decodes back BIT-EXACT. Nothing is rounded, and
 * nothing that cannot be reconstructed exactly is dropped:
 *
 * - `usd` is gone: it was |px·sz|, a derivation of two fields also shipped,
 *   and the decoder never read it.
 * - `fee` and `start` are gone: server-side inputs whose RESULTS the document
 *   already carries (`episodes[].fees`, `series.pos`). The playback type has
 *   no field for them, so their absence can never be read as a zero.
 * - `dt` is the fill times, first absolute and the rest as deltas.
 * - `px`, `sz`, `pnl` are fixed-point integers scaled by 10^e[i]; `px` is
 *   additionally delta-encoded. The encoder VERIFIES that every value
 *   divides back to the exact original double and falls back to e=0 (the
 *   raw values) for any column where it does not.
 * - `code` packs the direction-table index and the side: dirIdx * 2 + isBuy.
 *
 * Columns rather than rows because a column of like values compresses:
 * the same fills are 242 KB on the wire as v1 rows, 71 KB as v2 columns.
 */
export interface WireFills {
  /** Fill count — the length every column shares. */
  n: number
  /** Fill times: [0] absolute ms, the rest deltas from the previous fill. */
  dt: number[]
  /** Exchange prices, fixed-point by 10^e[0], delta-encoded. */
  px: number[]
  /** Exchange sizes, fixed-point by 10^e[1]. */
  sz: number[]
  /** Exchange realized PnL, fixed-point by 10^e[2]. */
  pnl: number[]
  /** dirIdx * 2 + (side === 'B' ? 1 : 0). */
  code: number[]
  /** Decimal exponents for [px, sz, pnl]; 0 means the column is raw. */
  e: [number, number, number]
}

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
  /** endsAtGap */
  0 | 1,
  /** startsAfterGap */
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
  v: 1 | 2 | 3
  schema:
    | typeof REPLAY_DOC_SCHEMA
    | typeof REPLAY_DOC_SCHEMA_V2
    | typeof REPLAY_DOC_SCHEMA_V1
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
  /** True only on a streamed HEAD document: the opening window of candles
   *  and fills, sent so playback can start while the tail loads. Head docs
   *  declare themselves (the player says the remainder is streaming), are
   *  never cached, and are always followed by the full document — or by an
   *  error, never by silence dressed as completeness. */
  partial?: boolean
  built_at: string
  /** Newest fill timestamp included (doc scope), ISO; null when none. */
  built_through: string | null
  fill_count_total: number
  starts_mid_position: boolean
  gap_coins: string[]
  /**
   * PROVEN discontinuities in the resolved coin's own fill series: stretches
   * where the exchange's start positions show fills we never captured. The
   * chart seams these and the ticker refuses to read across them.
   *
   * Proven only — a quiet stretch never reaches the wire, because "the wallet
   * did not trade" and "we did not measure" must not be drawn the same way.
   */
  coin_gaps: SeriesGap[]
  coverage: {
    fills: {
      source: 'store' | 'exchange'
      from: string | null
      to: string | null
      fill_count: number
      capped: boolean
      /** Wallet-level gaps behind the numbers in `note`. Proven only. */
      gaps?: SeriesGap[]
      contiguous?: boolean
      covered_ms?: number | null
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
  fills: WireFills | WireFill[]
  /** Per-bar running series, same length as candles: realized PnL after each
   *  bar (exchange closedPnl sums), position in coins after each bar, and
   *  cumulative fill count. */
  series: { realized: number[]; pos: number[]; fills_after: number[] }
}

// ── Encode (server) ─────────────────────────────────────────────────────────

export function encodeCandles(candles: RCandle[]): WireCandle[] {
  return candles.map(c => [c.t, c.o, c.h, c.l, c.c, c.v])
}

/** Decimal places in a number's shortest round-trip representation, or 99
 *  when it is written in exponent form (never fixed-point encoded). */
function decimalPlaces(x: number): number {
  const s = String(x)
  if (/[eE]/.test(s)) return 99
  const dot = s.indexOf('.')
  return dot < 0 ? 0 : s.length - dot - 1
}

/**
 * A column as fixed-point integers, scaled by 10^exponent — but ONLY if every
 * value divides back to the exact original double and stays a safe integer.
 * Any column that fails goes out unscaled. The check is the point: this is a
 * cheaper spelling of the same numbers, never a rounding of them.
 */
function fixedPoint(values: number[]): { e: number; v: number[] } {
  let places = 0
  for (const v of values) {
    const p = decimalPlaces(v)
    if (p > places) places = p
    if (places > 9) return { e: 0, v: values }
  }
  const scale = 10 ** places
  const out: number[] = new Array(values.length)
  for (let i = 0; i < values.length; i++) {
    const q = Math.round(values[i] * scale)
    if (!Number.isSafeInteger(q) || q / scale !== values[i]) return { e: 0, v: values }
    out[i] = q
  }
  return { e: places, v: out }
}

/** In-place first-difference. Exact for the integers it is given. */
function deltas(values: number[]): number[] {
  const out: number[] = new Array(values.length)
  for (let i = values.length - 1; i > 0; i--) out[i] = values[i] - values[i - 1]
  out[0] = values[0] ?? 0
  return out
}

function undeltas(values: number[]): number[] {
  const out: number[] = new Array(values.length)
  let run = 0
  for (let i = 0; i < values.length; i++) {
    run += values[i]
    out[i] = run
  }
  return out
}

export function encodeFills(fills: PlayFill[], dirs: string[]): WireFills {
  const dirIdx = new Map<string, number>(dirs.map((d, i) => [d, i]))
  const n = fills.length
  const t: number[] = new Array(n)
  const px: number[] = new Array(n)
  const sz: number[] = new Array(n)
  const pnl: number[] = new Array(n)
  const code: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const f = fills[i]
    let di = dirIdx.get(f.dir)
    if (di === undefined) {
      di = dirs.length
      dirs.push(f.dir)
      dirIdx.set(f.dir, di)
    }
    t[i] = f.t
    px[i] = f.px
    sz[i] = f.sz
    pnl[i] = f.pnl
    code[i] = di * 2 + (f.side === 'B' ? 1 : 0)
  }
  const PX = fixedPoint(px)
  const SZ = fixedPoint(sz)
  const PNL = fixedPoint(pnl)
  return {
    n,
    dt: deltas(t),
    // Prices walk; their differences are small and compress. Sizes and PnL
    // do not walk — measured, differencing them made both columns BIGGER.
    px: deltas(PX.v),
    sz: SZ.v,
    pnl: PNL.v,
    code,
    e: [PX.e, SZ.e, PNL.e],
  }
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
    e.endsAtGap ? 1 : 0,
    e.startsAfterGap ? 1 : 0,
  ])
}

// ── Decode (player) ─────────────────────────────────────────────────────────

export function decodeCandles(wire: WireCandle[]): RCandle[] {
  return wire.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
}

/** Decodes either wire shape — v2 columns or v1 rows — into the fills the
 *  player rolls. Cached v1 documents predate the columnar format and stay
 *  perfectly servable; the shape itself says which is which. */
export function decodeFills(wire: WireFills | WireFill[], dirs: string[]): PlayFill[] {
  if (Array.isArray(wire)) {
    return wire.map(([t, px, sz, sideB, , pnl, , , dirIdx]) => ({
      t,
      px,
      sz,
      side: sideB === 1 ? ('B' as const) : ('A' as const),
      dir: dirs[dirIdx] ?? '',
      pnl,
    }))
  }
  const t = undeltas(wire.dt)
  const pxScale = 10 ** wire.e[0]
  const szScale = 10 ** wire.e[1]
  const pnlScale = 10 ** wire.e[2]
  const px = undeltas(wire.px)
  const out: PlayFill[] = new Array(wire.n)
  for (let i = 0; i < wire.n; i++) {
    const c = wire.code[i]
    out[i] = {
      t: t[i],
      px: px[i] / pxScale,
      sz: wire.sz[i] / szScale,
      side: c % 2 === 1 ? 'B' : 'A',
      dir: dirs[(c - (c % 2)) / 2] ?? '',
      pnl: wire.pnl[i] / pnlScale,
    }
  }
  return out
}

export function decodeEpisodes(wire: WireEpisode[]): DocEpisode[] {
  return wire.map(
    ([
      from,
      to,
      pnl,
      fees,
      entries,
      exits,
      fills,
      maxPosCoins,
      maxPosUsd,
      before,
      atEnd,
      atGap,
      afterGap,
    ]) => ({
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
      endsAtGap: atGap === 1,
      startsAfterGap: afterGap === 1,
    })
  )
}
