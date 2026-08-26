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

/** One exchange fill, as the replay consumes it. */
export interface RFill {
  t: number
  px: number
  sz: number
  side: 'B' | 'A'
  dir: string
  pnl: number
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
  fills: RFill[]
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
  /** Median |closedPnl| over bars that closed anything — the FX scale unit. */
  typicalClosePnl: number
}

const isEntry = (f: RFill) => /^open/i.test(f.dir)
const isClose = (f: RFill) => /close|liquidat|>/i.test(f.dir) || f.pnl !== 0

export function buildTimeline(candles: RCandle[], intervalMs: number, fills: RFill[]): Timeline {
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

  const closeMagnitudes = events
    .filter(e => e.closedPnl !== 0)
    .map(e => Math.abs(e.closedPnl))
    .sort((a, b) => a - b)
  const typicalClosePnl =
    closeMagnitudes.length > 0 ? closeMagnitudes[Math.floor(closeMagnitudes.length / 2)] : 0

  return {
    candles,
    intervalMs,
    events,
    realizedAfter,
    fillsAfter,
    fillsOutsideWindow: outside,
    totalFills: fills.length,
    typicalClosePnl,
  }
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

/** The flash a bar's closes throw, 0..1, scaled by realized PnL against the
 *  wallet's own typical close — restrained by construction: a median close
 *  lands at 0.5, and the curve saturates instead of shouting. */
export function flashStrength(closedPnl: number, typical: number): number {
  if (closedPnl === 0) return 0
  if (typical <= 0) return 0.5
  const x = Math.abs(closedPnl) / typical
  return Math.min(x / (x + 1) + 0.15, 1)
}
