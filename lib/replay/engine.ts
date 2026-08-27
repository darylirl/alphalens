/**
 * NOTICE: Portions adapted from trickshot (https://github.com/nathanliow/trickshot)
 * Copyright (c) 2026 Nathan Liow — MIT License.
 * The bar-index-by-search approach (barAt) and the per-bar event/cue model
 * come from their src/lib/replay.ts and src/components/WalletReplay.tsx,
 * rebuilt here against AlphaLens's own fills and candles.
 *
 * The replay timeline: real candles, the wallet's real fills placed on them,
 * and the running realized PnL after each bar. Everything is precomputed once
 * when the data lands — the animation loop only indexes into it, and nothing
 * here ever synthesizes a price or a time.
 */

import type { Cued } from './sound'

export interface RCandle {
  t: number // bar open, ms
  o: number
  h: number
  l: number
  c: number
  v: number
}

/**
 * What PLAYBACK needs from a fill, and nothing else: the moment, the
 * exchange-reported price and size, the side, the direction string and the
 * exchange's own realized PnL. This is exactly the set the chart, the flash
 * painter and the timeline read — see the doc format, which carries only
 * these on the wire.
 */
export interface PlayFill {
  t: number
  px: number
  sz: number
  side: 'B' | 'A'
  dir: string
  pnl: number
}

/**
 * One exchange fill as the SERVER holds it — playback's fields plus the two
 * the server needs and the wire does not carry: the exchange's reported fee
 * and the position before the fill.
 *
 * The split is deliberate. Episode detection and the position series consume
 * `fee` and `start` server-side, where they are always real; the replay
 * document ships their RESULTS (episode fees, the per-bar position series)
 * rather than their inputs. Because the wire type simply lacks the fields,
 * no decoder can hand the player a fabricated zero for a fee we never sent.
 */
export interface RFill extends PlayFill {
  fee: number
  start: number | null
}

/**
 * The index of the bar a moment falls in, FOUND rather than computed.
 * `floor(ts / interval)` is only a bar index while the series has no gaps,
 * and a series with real gaps in it (which ours honestly keeps) does not.
 * Returns -1 for a moment before the first bar.
 */
export function barAt(candles: { t: number }[], ts: number): number {
  if (candles.length === 0) return -1
  if (ts < candles[0].t) return -1
  let lo = 0
  let hi = candles.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (candles[mid].t <= ts) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** What one bar of the replay contains, precomputed. */
export interface BarEvents {
  /** Fills that land in this bar, in time order. */
  fills: PlayFill[]
  /** Notional opened in this bar (Open * directions). */
  openedUsd: number
  /** Realized PnL closed in this bar (sum of fill pnl). */
  closedPnl: number
  hasEntry: boolean
  hasWinClose: boolean
  hasLossClose: boolean
}

export interface Timeline {
  candles: RCandle[]
  intervalMs: number
  /** Per-bar events, same length as candles. */
  events: BarEvents[]
  /** Cumulative realized PnL (sum of fill pnl minus nothing — the exchange's
   *  own closedPnl figures) AFTER each bar. */
  realizedAfter: number[]
  /** Cumulative fill count after each bar. */
  fillsAfter: number[]
  /** Fills outside the candle window — counted and reported, never dropped silently. */
  fillsOutsideWindow: number
  totalFills: number
}

const isEntry = (f: PlayFill) => /^open/i.test(f.dir)
const isClose = (f: PlayFill) => /close|liquidat|>/i.test(f.dir) || f.pnl !== 0

export function buildTimeline(
  candles: RCandle[],
  intervalMs: number,
  fills: PlayFill[]
): Timeline {
  const events: BarEvents[] = candles.map(() => ({
    fills: [],
    openedUsd: 0,
    closedPnl: 0,
    hasEntry: false,
    hasWinClose: false,
    hasLossClose: false,
  }))

  let outside = 0
  for (const f of fills) {
    const i = barAt(candles, f.t)
    // A fill belongs to a bar only if that bar actually spans it — with gaps
    // in the series, barAt returns the bar BEFORE a gap for moments inside it.
    const bar = i >= 0 && f.t < candles[i].t + intervalMs ? i : -1
    if (bar < 0) {
      outside++
      continue
    }
    const e = events[bar]
    e.fills.push(f)
    if (isEntry(f)) {
      e.hasEntry = true
      e.openedUsd += Math.abs(f.px * f.sz)
    }
    if (isClose(f)) {
      e.closedPnl += f.pnl
      if (f.pnl > 0) e.hasWinClose = true
      else if (f.pnl < 0) e.hasLossClose = true
    }
  }

  const realizedAfter: number[] = []
  const fillsAfter: number[] = []
  let pnl = 0
  let count = 0
  for (const e of events) {
    for (const f of e.fills) pnl += f.pnl
    count += e.fills.length
    realizedAfter.push(pnl)
    fillsAfter.push(count)
  }

  return {
    candles,
    intervalMs,
    events,
    realizedAfter,
    fillsAfter,
    fillsOutsideWindow: outside,
    totalFills: fills.length,
  }
}

/**
 * Merge every `factor` fine bars into one wider bar, in the browser.
 *
 * Adapted from trickshot's coarsen (src/components/WalletReplay.tsx): the
 * open comes from the first bar in the wall-clock bucket and the close from
 * the last, with the extremes and volume carried across all of them — which
 * is what a wider bar of the same trades is. Coarser ONLY: merging is
 * arithmetic on honest bars already in the browser; a finer bar is a
 * different series and goes back through the ladder's honesty checks.
 *
 * Holes stay holes: only bars that exist are merged, buckets nothing landed
 * in are simply absent, and the gap seam logic keys off the merged interval.
 */
export function coarsen(
  candles: RCandle[],
  intervalMs: number,
  factor: number
): { candles: RCandle[]; intervalMs: number } {
  if (factor <= 1 || candles.length === 0) return { candles, intervalMs }
  const merged = intervalMs * factor
  const out: RCandle[] = []
  let bucket = NaN
  for (const c of candles) {
    const t = Math.floor(c.t / merged) * merged
    const last = out[out.length - 1]
    if (!last || t !== bucket) {
      bucket = t
      out.push({ ...c, t })
      continue
    }
    last.h = Math.max(last.h, c.h)
    last.l = Math.min(last.l, c.l)
    last.c = c.c
    last.v += c.v
  }
  return { candles: out, intervalMs: merged }
}

/**
 * Every cue an exported clip will play, and when, in clip seconds. One cue
 * per kind per bar — a close split across a dozen fills is one event to the
 * ear, not twelve; clustered DISTINCT events still each get a voice.
 */
export function cueSchedule(tl: Timeline, stepMs: number): Cued[] {
  const cues: Cued[] = []
  for (let bar = 0; bar < tl.events.length; bar++) {
    const e = tl.events[bar]
    const t = (bar * stepMs) / 1000
    if (e.hasEntry) cues.push({ t, cue: 'entry' })
    if (e.hasWinClose) cues.push({ t: t + 0.05, cue: 'win' })
    if (e.hasLossClose) cues.push({ t: t + 0.05, cue: 'loss' })
  }
  return cues
}
