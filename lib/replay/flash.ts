/**
 * NOTICE: Portions adapted from trickshot (https://github.com/nathanliow/trickshot)
 * Copyright (c) 2026 Nathan Liow — MIT License. (src/components/WalletReplay.tsx)
 * The flash lifecycle (enter/shown/out), the displacement rule (a new fill
 * pushes the previous one OUT rather than stacking on it), the stacking slots
 * for a bar holding both sides, and the 900ms wash curve come from there.
 * Rebuilt as a pure function of replay time so the live loop and the clip
 * exporter draw flashes from the same instruction — neither can drift.
 *
 * Fills announce themselves: every fill pops a card over the chart — side
 * color, USD size — with a brief neutral wash, then fades, leaving the
 * persistent below-bar/above-bar marker the chart already draws. The unit is
 * the LABEL, not the trade: a bar's fills are summed per side, because twelve
 * numbers climbing the screen together say less than two do.
 */

import type { Timeline } from './engine'
import { usdCompact } from './format'

/** How long a card holds before it leaves of its own accord. */
export const FLASH_HOLD_MS = 1_400
/** The enter rise and the exit fade, each. */
export const FLASH_FADE_MS = 240
/** The neutral wash a fill throws, on its own 900ms curve. */
export const WASH_MS = 900

/** One bar's worth of announcements: per-side sums, slotted. */
export interface FlashGroup {
  bar: number
  cards: { side: 'B' | 'A'; usd: number; count: number }[]
}

/** One card as painted at one moment. */
export interface PaintFlash {
  side: 'B' | 'A'
  usd: number
  count: number
  /** Stacking slot — a buy and a sell in one bar do not sit on each other. */
  slot: number
  alpha: number
  /** Vertical offset in design px: +14 entering, drifting to −30 leaving. */
  dy: number
  scale: number
  /** Neutral wash strength 0..1; only a card not on its way out glows. */
  wash: number
}

/** Every bar that has fills, as the flash system announces it — buys first
 *  (below-bar side), then sells, each side summed into one card. */
export function collectFlashGroups(tl: Timeline): FlashGroup[] {
  const groups: FlashGroup[] = []
  for (let bar = 0; bar < tl.events.length; bar++) {
    const fills = tl.events[bar].fills
    if (fills.length === 0) continue
    const cards: FlashGroup['cards'] = []
    for (const side of ['B', 'A'] as const) {
      const ours = fills.filter(f => f.side === side)
      if (ours.length === 0) continue
      cards.push({
        side,
        usd: ours.reduce((s, f) => s + Math.abs(f.px * f.sz), 0),
        count: ours.length,
      })
    }
    groups.push({ bar, cards })
  }
  return groups
}

function smootherstep(p: number): number {
  const c = Math.min(Math.max(p, 0), 1)
  return c * c * (3 - 2 * c)
}

/** The wash curve: up fast, down slow, gone by WASH_MS. */
export function washAt(age: number): number {
  if (age < 0 || age > WASH_MS) return 0
  return age < 198 ? age / 198 : 1 - (age - 198) / (WASH_MS - 198)
}

/**
 * The cards over the chart at one moment of replay time.
 *
 * Time is the replay clock (bar * stepMs), not the wall clock — which is what
 * lets the exporter ask the exact same question per frame. The displacement
 * rule is the part that matters: only the most recent filled bar is fully on
 * screen; the one before it is fading out from wherever it had got to.
 * Deriving "any fill within hold time" instead would pile eighteen bars of
 * labels on top of each other at 8x.
 */
export function flashesAt(groups: FlashGroup[], stepMs: number, clipMs: number): PaintFlash[] {
  if (groups.length === 0) return []
  // Last group whose bar has been reached.
  let lo = 0
  let hi = groups.length - 1
  if (groups[0].bar * stepMs > clipMs) return []
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (groups[mid].bar * stepMs <= clipMs) lo = mid
    else hi = mid - 1
  }
  const cursor = lo

  const out: PaintFlash[] = []
  const push = (group: FlashGroup, leftAt: number | null) => {
    const at = group.bar * stepMs
    const age = clipMs - at
    group.cards.forEach((c, slot) => {
      let alpha: number
      let dy: number
      let scale: number
      let wash = 0
      if (leftAt === null) {
        const enter = smootherstep(age / FLASH_FADE_MS)
        alpha = enter
        dy = 14 * (1 - enter)
        scale = 0.94 + 0.06 * enter
        wash = washAt(age)
      } else {
        const gone = (clipMs - leftAt) / FLASH_FADE_MS
        alpha = Math.max(0, 1 - gone)
        dy = -30 * Math.min(gone, 1)
        scale = 1
      }
      if (alpha <= 0) return
      out.push({ side: c.side, usd: c.usd, count: c.count, slot, alpha, dy, scale, wash })
    })
  }

  const live = groups[cursor]
  const liveAt = live.bar * stepMs
  const expired = clipMs - liveAt > FLASH_HOLD_MS
  push(live, expired ? liveAt + FLASH_HOLD_MS : null)

  // The displaced one, still leaving.
  const before = groups[cursor - 1]
  if (before) {
    const beforeAt = before.bar * stepMs
    // It may already have retired on its own before being displaced.
    push(before, Math.min(liveAt, beforeAt + FLASH_HOLD_MS))
  }

  return out
}

const UP = '#34EAB9'
const DOWN = '#FF3B5C'
const MONO = 'ui-monospace, "JetBrains Mono", "SF Mono", monospace'

/**
 * Paint the cards and the wash into a canvas rect. The one painter: the live
 * loop calls it over the chart it just drew, and the exporter calls it over
 * the frame it is composing — an exported flash cannot differ from the screen.
 */
export function drawFlashes(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  k: number,
  flashes: PaintFlash[]
): void {
  if (flashes.length === 0) return
  ctx.save()
  ctx.beginPath()
  ctx.rect(rect.x, rect.y, rect.w, rect.h)
  ctx.clip()

  // The neutral wash: brief, restrained, and off the frame edges — drama from
  // motion, not decor. One wash per moment (the arriving bar's strongest).
  const wash = Math.max(...flashes.map(f => f.wash), 0)
  if (wash > 0.01) {
    const glow = ctx.createRadialGradient(
      rect.x + rect.w / 2,
      rect.y + rect.h / 2,
      0,
      rect.x + rect.w / 2,
      rect.y + rect.h / 2,
      Math.max(rect.w, rect.h) * 0.6
    )
    glow.addColorStop(0, `rgba(240,250,248,${(wash * 0.09).toFixed(4)})`)
    glow.addColorStop(1, 'rgba(240,250,248,0)')
    ctx.fillStyle = glow
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
  }

  for (const f of flashes) {
    const size = 22 * k * f.scale
    const y = rect.y + (40 + f.slot * 42 + f.dy) * k
    const x = rect.x + rect.w / 2
    const label = `${usdCompact(f.usd)} ${f.side === 'B' ? 'BUY' : 'SELL'}`
    const suffix = f.count > 1 ? ` · ${f.count} fills` : ''
    const labelFont = `800 ${size}px ${MONO}`
    const suffixFont = `700 ${15 * k * f.scale}px ${MONO}`
    ctx.save()
    ctx.globalAlpha = f.alpha
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.font = labelFont
    const labelW = ctx.measureText(label).width
    ctx.font = suffixFont
    const suffixW = suffix ? ctx.measureText(suffix).width : 0
    const w = labelW + suffixW
    const left = x - w / 2
    // A soft dark backing so the card reads over any candle behind it.
    const padX = 10 * k
    const padY = 7 * k
    ctx.fillStyle = 'rgba(10,20,23,0.55)'
    ctx.beginPath()
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(left - padX, y - size / 2 - padY, w + padX * 2, size + padY * 2, 6 * k)
    } else {
      ctx.rect(left - padX, y - size / 2 - padY, w + padX * 2, size + padY * 2)
    }
    ctx.fill()
    ctx.font = labelFont
    ctx.fillStyle = f.side === 'B' ? UP : DOWN
    ctx.fillText(label, left, y)
    if (suffix) {
      ctx.font = suffixFont
      ctx.fillStyle = 'rgba(240,250,248,0.55)'
      ctx.fillText(suffix, left + labelW, y)
    }
    ctx.restore()
  }
  ctx.restore()
}
