/**
 * The replay's candle chart, painted straight onto a canvas.
 *
 * A pure painter with no DOM of its own: the live player calls it every
 * animation frame against its on-screen canvas, and the clip exporter calls
 * it against the export frame — one draw function, so an exported chart can
 * never disagree with the screen it was recorded from.
 *
 * Honesty rules drawn in, not written beside: bars are real captured or
 * exchange-served candles only; where the series has a hole the chart draws a
 * marked gap seam rather than bridging it; the wallet's fills are marked on
 * the exact bars their exchange timestamps fall in.
 */

import type { RCandle, BarEvents } from './engine'
import { priceLabel, stamp } from './format'

export const COLORS = {
  bg: '#0F1A1E',
  panel: '#0A1417',
  grid: 'rgba(255,255,255,0.05)',
  axisText: 'rgba(240,250,248,0.45)',
  up: '#34EAB9',
  down: '#FF3B5C',
  gap: '#F5A623',
  text: '#F0FAF8',
}

export interface ChartRect {
  x: number
  y: number
  w: number
  h: number
}

export interface ChartState {
  candles: RCandle[]
  intervalMs: number
  events: BarEvents[]
  /** Current bar index and its forming progress 0..1. */
  bar: number
  p: number
  /** Pixels per bar, in the same units as the rect. */
  barSpacing: number
  /** Type-scale factor for axis text (1 = 10px labels). */
  k: number
}

const AXIS_W = 56 // price axis gutter, scaled by k
const TIME_H = 18

function ease(p: number): number {
  const c = Math.min(Math.max(p, 0), 1)
  return c * c * (3 - 2 * c)
}

/** The forming bar's OHLC at progress p — the close walks from the open
 *  toward the real close with the extremes revealed as it goes, the way a
 *  live candle behaves while trades land in it. */
function forming(c: RCandle, p: number): RCandle {
  const e = ease(p)
  const close = c.o + (c.c - c.o) * e
  return {
    ...c,
    c: close,
    h: Math.max(c.o, close, c.o + (c.h - c.o) * e),
    l: Math.min(c.o, close, c.o + (c.l - c.o) * e),
  }
}

export function drawChart(ctx: CanvasRenderingContext2D, rect: ChartRect, s: ChartState): void {
  const { candles, events, intervalMs, bar, p, barSpacing, k } = s
  const axisW = AXIS_W * k
  const timeH = TIME_H * k
  const plotW = rect.w - axisW
  const plotH = rect.h - timeH
  if (plotW <= 0 || plotH <= 0 || candles.length === 0) return

  ctx.save()
  ctx.beginPath()
  ctx.rect(rect.x, rect.y, rect.w, rect.h)
  ctx.clip()
  ctx.fillStyle = COLORS.panel
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h)

  const visible = Math.max(Math.floor(plotW / barSpacing), 8)
  const rightPad = Math.max(Math.floor(visible * 0.18), 2)
  const last = Math.min(bar, candles.length - 1)
  const start = Math.max(last - (visible - rightPad) + 1, 0)

  // Price range over what is actually on screen, marker headroom included.
  let lo = Infinity
  let hi = -Infinity
  for (let i = start; i <= last; i++) {
    const c = i === last && p < 1 ? forming(candles[i], p) : candles[i]
    if (c.l < lo) lo = c.l
    if (c.h > hi) hi = c.h
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    ctx.restore()
    return
  }
  if (hi === lo) {
    hi += hi === 0 ? 1 : Math.abs(hi) * 0.001
    lo -= lo === 0 ? 1 : Math.abs(lo) * 0.001
  }
  const pad = (hi - lo) * 0.1
  hi += pad
  lo -= pad

  const yOf = (v: number) => rect.y + ((hi - v) / (hi - lo)) * plotH
  const xOf = (i: number) => rect.x + (i - start) * barSpacing + barSpacing / 2

  // Grid + price axis
  ctx.font = `${10 * k}px ui-monospace, "JetBrains Mono", monospace`
  ctx.textBaseline = 'middle'
  const ticks = 4
  for (let t = 0; t <= ticks; t++) {
    const v = lo + ((hi - lo) * t) / ticks
    const y = yOf(v)
    ctx.strokeStyle = COLORS.grid
    ctx.lineWidth = Math.max(k * 0.75, 0.75)
    ctx.beginPath()
    ctx.moveTo(rect.x, y)
    ctx.lineTo(rect.x + plotW, y)
    ctx.stroke()
    ctx.fillStyle = COLORS.axisText
    ctx.textAlign = 'left'
    // Clamped so the extreme ticks stay inside the rect instead of clipping.
    const ly = Math.min(Math.max(y, rect.y + 6 * k), rect.y + plotH - 6 * k)
    ctx.fillText(priceLabel(v), rect.x + plotW + 6 * k, ly)
  }

  // Time axis: labels spaced by their rendered width, so neighbours never
  // bleed into each other however narrow the bars are.
  ctx.textAlign = 'center'
  ctx.fillStyle = COLORS.axisText
  const labelEvery = Math.max(Math.ceil((92 * k) / barSpacing), 1)
  for (let i = start; i <= last; i++) {
    if ((i - start) % labelEvery !== 0) continue
    const x = xOf(i)
    if (x > rect.x + plotW - 40 * k) continue // half a label from the axis
    ctx.fillText(stamp(candles[i].t), x, rect.y + plotH + timeH / 2)
  }

  // Candles
  const bodyW = Math.max(barSpacing * 0.62, 1)
  for (let i = start; i <= last; i++) {
    const c = i === last && p < 1 ? forming(candles[i], p) : candles[i]
    const x = xOf(i)
    const up = c.c >= c.o
    const color = up ? COLORS.up : COLORS.down

    // Gap seam: the previous bar is not this bar's neighbour in time. Drawn
    // as a marked amber seam so a hole in the data reads as a hole, never as
    // continuity.
    if (i > start && candles[i].t - candles[i - 1].t > intervalMs * 1.5) {
      const gx = x - barSpacing / 2
      ctx.strokeStyle = COLORS.gap
      ctx.lineWidth = Math.max(k, 1)
      ctx.setLineDash([3 * k, 3 * k])
      ctx.beginPath()
      ctx.moveTo(gx, rect.y + 2 * k)
      ctx.lineTo(gx, rect.y + plotH - 2 * k)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = COLORS.gap
      ctx.textAlign = 'center'
      ctx.fillText('gap', gx, rect.y + 8 * k)
    }

    ctx.strokeStyle = color
    ctx.lineWidth = Math.max(k, 1)
    ctx.beginPath()
    ctx.moveTo(x, yOf(c.h))
    ctx.lineTo(x, yOf(c.l))
    ctx.stroke()

    const yO = yOf(c.o)
    const yC = yOf(c.c)
    ctx.fillStyle = color
    ctx.fillRect(x - bodyW / 2, Math.min(yO, yC), bodyW, Math.max(Math.abs(yC - yO), k))
  }

  // Fill markers: the wallet's own trades on the bars they landed in.
  // Buys hang below the low, sells sit above the high.
  const m = Math.max(3.5 * k, 3)
  for (let i = start; i <= last; i++) {
    const e = events[i]
    if (!e || e.fills.length === 0) continue
    const x = xOf(i)
    const hasBuy = e.fills.some(f => f.side === 'B')
    const hasSell = e.fills.some(f => f.side === 'A')
    if (hasBuy) {
      const y = yOf(candles[i].l) + 8 * k
      ctx.fillStyle = COLORS.up
      ctx.beginPath()
      ctx.moveTo(x, y - m)
      ctx.lineTo(x - m, y + m)
      ctx.lineTo(x + m, y + m)
      ctx.closePath()
      ctx.fill()
    }
    if (hasSell) {
      const y = yOf(candles[i].h) - 8 * k
      ctx.fillStyle = COLORS.down
      ctx.beginPath()
      ctx.moveTo(x, y + m)
      ctx.lineTo(x - m, y - m)
      ctx.lineTo(x + m, y - m)
      ctx.closePath()
      ctx.fill()
    }
  }

  ctx.restore()
}
