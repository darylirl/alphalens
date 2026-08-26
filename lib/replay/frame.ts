/**
 * NOTICE: Portions adapted from trickshot (https://github.com/nathanliow/trickshot)
 * Copyright (c) 2026 Nathan Liow — MIT License. (src/lib/frame.ts)
 * The composed-frame idea — header, chart, coverage band and outro painted
 * around the chart at export resolution — comes from there; the layout, the
 * coverage strip and the watermark are AlphaLens's own.
 *
 * One frame of an exported clip, painted. The receipts travel INSIDE the
 * clip: every frame carries the coverage/granularity strip and the AlphaLens
 * watermark, so a reposted video still says what data it was drawn from.
 */

import { drawChart, COLORS, type ChartState } from './chart'
import { signedUsd, usdCompact } from './format'
import { CLIP_W, CLIP_H } from './clipspec'

const MONO = 'ui-monospace, "JetBrains Mono", "SF Mono", monospace'

export interface FrameState {
  chart: ChartState
  coin: string
  address: string
  label: string | null
  /** Running realized PnL at the current bar — the exchange's own figures. */
  realized: number
  fillsSoFar: number
  /** The coverage/granularity strip, exactly as the page shows it. */
  stripLines: string[]
  watermark: string
  /** Flash overlays for recent closes: strength 0..1 and sign. */
  flashes: { strength: number; win: boolean; alpha: number }[]
  /** 0 while the replay runs; 0..1 across the end card. */
  outro: number
  final: { realized: number; fills: number; windowLabel: string; cardUrl: string } | null
}

function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  o: { size: number; weight?: number; color?: string; align?: CanvasTextAlign; alpha?: number }
): void {
  ctx.save()
  ctx.font = `${o.weight ?? 400} ${o.size}px ${MONO}`
  ctx.fillStyle = o.color ?? COLORS.text
  ctx.textAlign = o.align ?? 'left'
  ctx.textBaseline = 'alphabetic'
  if (o.alpha !== undefined) ctx.globalAlpha = o.alpha
  ctx.fillText(s, x, y)
  ctx.restore()
}

function ease(p: number): number {
  const c = Math.min(Math.max(p, 0), 1)
  return c * c * (3 - 2 * c)
}

const PAD = 56
const HEADER_H = 170
const STRIP_H = 130

export function paintFrame(ctx: CanvasRenderingContext2D, s: FrameState): void {
  ctx.fillStyle = COLORS.bg
  ctx.fillRect(0, 0, CLIP_W, CLIP_H)

  // Header: coin + wallet left, running realized PnL right.
  text(ctx, 'ALPHALENS · TRADE REPLAY', PAD, 64, {
    size: 22,
    weight: 700,
    color: 'rgba(240,250,248,0.5)',
  })
  text(ctx, s.coin, PAD, 118, { size: 44, weight: 800, color: '#F5A623' })
  text(ctx, s.label ? `${s.label} · ${s.address}` : s.address, PAD, 152, {
    size: 22,
    color: 'rgba(240,250,248,0.6)',
  })
  text(ctx, signedUsd(s.realized), CLIP_W - PAD, 122, {
    size: 76,
    weight: 800,
    color: s.realized >= 0 ? COLORS.up : COLORS.down,
    align: 'right',
  })
  text(ctx, `REALIZED PNL · EXCHANGE-EXACT FILLS (${s.fillsSoFar})`, CLIP_W - PAD, 154, {
    size: 17,
    weight: 700,
    color: 'rgba(240,250,248,0.45)',
    align: 'right',
  })

  drawChart(
    ctx,
    { x: PAD, y: HEADER_H, w: CLIP_W - PAD * 2, h: CLIP_H - HEADER_H - STRIP_H },
    s.chart
  )

  // Restrained flash: a wash off the frame edge, scaled by realized PnL.
  for (const f of s.flashes) {
    const a = f.strength * f.alpha * 0.22
    if (a <= 0.005) continue
    const tint = f.win ? '52, 234, 185' : '255, 59, 92'
    const glow = ctx.createRadialGradient(
      CLIP_W / 2,
      CLIP_H / 2,
      0,
      CLIP_W / 2,
      CLIP_H / 2,
      CLIP_W * 0.6
    )
    glow.addColorStop(0, `rgba(${tint}, ${a})`)
    glow.addColorStop(1, `rgba(${tint}, 0)`)
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, CLIP_W, CLIP_H)
  }

  // Coverage/granularity strip + watermark — on every frame, by design.
  const stripY = CLIP_H - STRIP_H
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(PAD, stripY + 8)
  ctx.lineTo(CLIP_W - PAD, stripY + 8)
  ctx.stroke()
  s.stripLines.slice(0, 2).forEach((line, i) => {
    text(ctx, line, PAD, stripY + 48 + i * 32, {
      size: 20,
      color: 'rgba(240,250,248,0.55)',
    })
  })
  text(ctx, s.watermark, CLIP_W - PAD, stripY + 48, {
    size: 22,
    weight: 700,
    color: 'rgba(52,234,185,0.85)',
    align: 'right',
  })

  if (s.outro > 0) paintOutro(ctx, s)
}

/** The end card: the chart dims behind a scrim and the final realized PnL
 *  settles in, with the pointer to the report card. The last frame doubles
 *  as the thumbnail. */
function paintOutro(ctx: CanvasRenderingContext2D, s: FrameState): void {
  const veil = ease(s.outro / 0.28) * 0.82
  ctx.fillStyle = `rgba(10, 20, 23, ${veil})`
  // The scrim covers the chart, not the coverage strip — receipts stay legible.
  ctx.fillRect(0, 0, CLIP_W, CLIP_H - STRIP_H)

  const f = s.final
  if (!f) return
  const appear = ease((s.outro - 0.12) / 0.3)
  if (appear <= 0) return
  const count = ease((s.outro - 0.12) / 0.45)
  const lift = (1 - appear) * 24

  text(ctx, `${s.coin} · ${f.windowLabel}`, CLIP_W / 2, 380 - lift, {
    size: 30,
    weight: 700,
    color: 'rgba(240,250,248,0.6)',
    align: 'center',
    alpha: appear,
  })
  text(ctx, signedUsd(f.realized * count), CLIP_W / 2, 520 - lift, {
    size: 120,
    weight: 800,
    color: f.realized >= 0 ? COLORS.up : COLORS.down,
    align: 'center',
    alpha: appear,
  })
  text(ctx, `REALIZED PNL · ${f.fills} FILLS · EXCHANGE-EXACT PRICES`, CLIP_W / 2, 580 - lift, {
    size: 22,
    weight: 700,
    color: 'rgba(240,250,248,0.5)',
    align: 'center',
    alpha: appear,
  })
  text(ctx, `get the grade → ${f.cardUrl}`, CLIP_W / 2, 680 - lift, {
    size: 26,
    weight: 700,
    color: '#34EAB9',
    align: 'center',
    alpha: appear,
  })
}

export { usdCompact }
