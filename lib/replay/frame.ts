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
 *
 * The flashes are drawn by the same painter the live player uses
 * (lib/replay/flash.ts) — one painter rule: an exported flash cannot differ
 * from the one on screen.
 */

import { drawChart, COLORS, type ChartState } from './chart'
import { drawFlashes, type PaintFlash } from './flash'
import { signedUsd, signedUsdExact, usdCompact, dayStamp, durationLabel } from './format'
import { CLIP_W, CLIP_H } from './clipspec'

const MONO = 'ui-monospace, "JetBrains Mono", "SF Mono", monospace'

/** What the title and end cards say about the episode being replayed. */
export interface EpisodeCard {
  /** "BTC" */
  coin: string
  /** "2026-07-03 – 2026-07-04" or a single day. */
  period: string
  entries: number
  exits: number
  /** Largest position held, valued at the fill price that set it. */
  maxPosUsd: number
  durationMs: number
  /** Net realized PnL over the episode (exchange closedPnl figures). */
  pnl: number
  /** "episode 2 of 7" / "entire history". */
  which: string
  /** Partial-picture caveats, already worded ('' when none). */
  caveat: string
}

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
  /** Fill cards over the chart, from the shared flash timeline. */
  flashes: PaintFlash[]
  /** 1..0 across the title card (1 = fully shown, 0 = gone; chart underneath). */
  intro: number
  /** 0 while the replay runs; 0..1 across the end card. */
  outro: number
  episode: EpisodeCard | null
  final: { fills: number; windowLabel: string; cardUrl: string } | null
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

  const chartRect = { x: PAD, y: HEADER_H, w: CLIP_W - PAD * 2, h: CLIP_H - HEADER_H - STRIP_H }
  drawChart(ctx, chartRect, s.chart)

  // Fill announcements — the same painter the live chart uses.
  drawFlashes(ctx, chartRect, 2, s.flashes)

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

  if (s.intro > 0) paintTitle(ctx, s)
  if (s.outro > 0) paintOutro(ctx, s)
}

/** The title card that opens an episode: coin, period, "N entries, M exits".
 *  Painted over the opening frame and eased away as the replay starts. */
function paintTitle(ctx: CanvasRenderingContext2D, s: FrameState): void {
  const e = s.episode
  if (!e) return
  const a = ease(s.intro)
  ctx.fillStyle = `rgba(10, 20, 23, ${(0.86 * a).toFixed(4)})`
  ctx.fillRect(0, 0, CLIP_W, CLIP_H - STRIP_H)
  const lift = (1 - a) * 18

  text(ctx, e.which.toUpperCase(), CLIP_W / 2, 350 - lift, {
    size: 24,
    weight: 700,
    color: 'rgba(240,250,248,0.5)',
    align: 'center',
    alpha: a,
  })
  text(ctx, e.coin, CLIP_W / 2, 460 - lift, {
    size: 96,
    weight: 800,
    color: '#F5A623',
    align: 'center',
    alpha: a,
  })
  text(ctx, e.period, CLIP_W / 2, 520 - lift, {
    size: 30,
    weight: 700,
    color: 'rgba(240,250,248,0.65)',
    align: 'center',
    alpha: a,
  })
  text(
    ctx,
    `${e.entries} ${e.entries === 1 ? 'entry' : 'entries'}, ${e.exits} ${e.exits === 1 ? 'exit' : 'exits'} · ${durationLabel(e.durationMs)}`,
    CLIP_W / 2,
    580 - lift,
    {
      size: 26,
      weight: 700,
      color: 'rgba(240,250,248,0.55)',
      align: 'center',
      alpha: a,
    }
  )
  if (e.caveat) {
    text(ctx, e.caveat, CLIP_W / 2, 630 - lift, {
      size: 20,
      color: '#F5A623',
      align: 'center',
      alpha: a,
    })
  }
}

/** The end card that closes an episode: net realized PnL big and USD-explicit,
 *  the entries/exits/max-size recap, and the pointer to the report card. The
 *  last frame doubles as the thumbnail. */
function paintOutro(ctx: CanvasRenderingContext2D, s: FrameState): void {
  const veil = ease(s.outro / 0.28) * 0.86
  ctx.fillStyle = `rgba(10, 20, 23, ${veil})`
  // The scrim covers the chart, not the coverage strip — receipts stay legible.
  ctx.fillRect(0, 0, CLIP_W, CLIP_H - STRIP_H)

  const e = s.episode
  const f = s.final
  if (!e || !f) return
  const appear = ease((s.outro - 0.12) / 0.3)
  if (appear <= 0) return
  const count = ease((s.outro - 0.12) / 0.45)
  const lift = (1 - appear) * 24

  text(ctx, `${e.coin} · ${e.period} · ${e.which}`, CLIP_W / 2, 360 - lift, {
    size: 28,
    weight: 700,
    color: 'rgba(240,250,248,0.6)',
    align: 'center',
    alpha: appear,
  })
  text(ctx, signedUsdExact(e.pnl * count), CLIP_W / 2, 500 - lift, {
    size: 112,
    weight: 800,
    color: e.pnl >= 0 ? COLORS.up : COLORS.down,
    align: 'center',
    alpha: appear,
  })
  text(ctx, 'NET REALIZED PNL, USD · EXCHANGE FIGURES', CLIP_W / 2, 556 - lift, {
    size: 22,
    weight: 700,
    color: 'rgba(240,250,248,0.5)',
    align: 'center',
    alpha: appear,
  })
  text(
    ctx,
    `${e.entries} ${e.entries === 1 ? 'entry' : 'entries'} · ${e.exits} ${e.exits === 1 ? 'exit' : 'exits'} · max position ${usdCompact(e.maxPosUsd)} · ${durationLabel(e.durationMs)}`,
    CLIP_W / 2,
    620 - lift,
    {
      size: 26,
      weight: 700,
      color: 'rgba(240,250,248,0.6)',
      align: 'center',
      alpha: appear,
    }
  )
  if (e.caveat) {
    text(ctx, e.caveat, CLIP_W / 2, 664 - lift, {
      size: 20,
      color: '#F5A623',
      align: 'center',
      alpha: appear,
    })
  }
  text(ctx, `get the grade → ${f.cardUrl}`, CLIP_W / 2, e.caveat ? 724 - lift : 700 - lift, {
    size: 26,
    weight: 700,
    color: '#34EAB9',
    align: 'center',
    alpha: appear,
  })
}

export { usdCompact, dayStamp }
