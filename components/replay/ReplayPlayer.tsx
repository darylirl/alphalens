'use client'

/**
 * NOTICE: Portions adapted from trickshot (https://github.com/nathanliow/trickshot)
 * Copyright (c) 2026 Nathan Liow — MIT License. (src/components/WalletReplay.tsx)
 * The single-writer seek model, the rAF-driven bar loop, and the exporter
 * driving the same draw path as the screen come from there — rebuilt against
 * AlphaLens's own fills/candles APIs and canvas chart.
 *
 * Animated playback of a wallet's actual trades on a real candle chart, at
 * exchange-exact execution prices: every marked fill is a real fill at its
 * reported price, and the running PnL is the sum of the exchange's own
 * closedPnl figures — nothing is mark-priced or reconstructed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Pause,
  Play,
  Repeat,
  Maximize2,
  Minimize2,
  RectangleHorizontal,
  Volume2,
  VolumeX,
  Download,
  ArrowRight,
} from 'lucide-react'
import { buildTimeline, cueSchedule, flashStrength, type RFill, type Timeline } from '@/lib/replay/engine'
import { drawChart } from '@/lib/replay/chart'
import { CANDLE_INTERVALS, INTERVAL_MS, retentionStart, MAX_BARS } from '@/lib/replay/ladder'
import { play as playCue, prepare as prepareSound, renderCues } from '@/lib/replay/sound'
import { signedUsd, usdCompact, dayStamp, durationLabel } from '@/lib/replay/format'
import { paintFrame } from '@/lib/replay/frame'
import { MAX_CLIP_SECONDS, OUTRO_SECONDS, FPS } from '@/lib/replay/clipspec'
import type { Encoders } from '@/lib/replay/clip'
import { save } from '@/lib/replay/record'

// The encoder (mediabunny/WebCodecs) is loaded only when someone actually
// exports — it has no place in the first paint of a mobile page.
let clipChunk: Promise<typeof import('@/lib/replay/clip')> | null = null
function loadClip() {
  clipChunk ??= import('@/lib/replay/clip')
  return clipChunk
}

// ---------------------------------------------------------------------------

interface ReplayMeta {
  address: string
  identity: { label: string | null; archetype: string | null; cohort_member: boolean }
  coverage: { source: string; note: string; fill_count: number }
  gap_coins: string[]
  coins: { coin: string; fills: number; from: number; to: number }[]
  default_coin: string | null
}

interface IntervalOption {
  interval: string
  interval_ms: number
  available: boolean
  source: 'exchange' | 'store' | null
  reason: string | null
}

interface CandlesRes {
  coin: string
  interval: string
  interval_ms: number
  source: 'exchange' | 'store'
  from: number
  to: number
  candles: { t: number; o: number; h: number; l: number; c: number; v: number }[]
  coverage: {
    bars: number
    window_bars: number
    internal_gaps: number
    largest_internal_gap_ms: number
    note: string
  }
  intervals: IntervalOption[]
}

const SPEEDS = [
  { label: '1x', stepMs: 600 },
  { label: '10x', stepMs: 60 },
  { label: '60x', stepMs: 10 },
  { label: 'max', stepMs: 2 },
] as const

const RANGES = [
  { key: '24h', ms: 24 * 3600_000 },
  { key: '7d', ms: 7 * 24 * 3600_000 },
  { key: '30d', ms: 30 * 24 * 3600_000 },
  { key: 'all', ms: Infinity },
] as const

/** Target bar count when auto-picking the finest honest interval. */
const TARGET_BARS = 1400

/** The wash a close throws, on a 900ms curve. */
const FLASH_MS = 900
function washAt(age: number): number {
  if (age < 0 || age > FLASH_MS) return 0
  return age < 200 ? age / 200 : 1 - (age - 200) / (FLASH_MS - 200)
}

type SizeMode = 'normal' | 'theater' | 'full'

export function ReplayPlayer({ address }: { address: string }) {
  const [meta, setMeta] = useState<ReplayMeta | null>(null)
  const [metaError, setMetaError] = useState<string | null>(null)
  const [coin, setCoin] = useState<string | null>(null)
  const [rangeKey, setRangeKey] = useState<(typeof RANGES)[number]['key']>('7d')
  const [pickedInterval, setPickedInterval] = useState<string | null>(null) // null = auto
  const [fills, setFills] = useState<RFill[] | null>(null)
  const [fillsMidPosition, setFillsMidPosition] = useState(false)
  const [candlesRes, setCandlesRes] = useState<CandlesRes | null>(null)
  const [dataError, setDataError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [playing, setPlaying] = useState(false)
  const [speedIdx, setSpeedIdx] = useState(1)
  const [loop, setLoop] = useState(false)
  const [soundOn, setSoundOn] = useState(false) // research product: muted by default
  const [sizeMode, setSizeMode] = useState<SizeMode>('normal')
  const [ended, setEnded] = useState(false)
  /** Display-side playhead, synced ~10x/s from the loop's ref. */
  const [atDisplay, setAtDisplay] = useState(0)

  const [encoders, setEncoders] = useState<Encoders | null | 'probing'>('probing')
  const [clipping, setClipping] = useState<number | null>(null)
  const [tooLong, setTooLong] = useState<number | null>(null)
  const abortClip = useRef(false)

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const at = useRef(0) // playhead bar, source of truth for the loop
  const flashesRef = useRef<{ born: number; strength: number; win: boolean }[]>([])
  const lastCuedBar = useRef(-1)

  // Ask once what this browser can encode; the export button says the answer.
  useEffect(() => {
    let dead = false
    void loadClip()
      .then(m => m.negotiate())
      .then(e => {
        if (!dead) setEncoders(e)
      })
      .catch(() => {
        if (!dead) setEncoders(null)
      })
    return () => {
      dead = true
    }
  }, [])

  // --- Meta -----------------------------------------------------------------
  useEffect(() => {
    let dead = false
    fetch(`/api/replay/${address}`, { cache: 'no-store' })
      .then(async res => {
        const body = await res.json()
        if (dead) return
        if (!res.ok) setMetaError(body?.error ?? `error ${res.status}`)
        else {
          setMeta(body as ReplayMeta)
          setCoin((body as ReplayMeta).default_coin)
        }
      })
      .catch(() => {
        if (!dead) setMetaError('Could not reach the replay API just now.')
      })
    return () => {
      dead = true
    }
  }, [address])

  const coinInfo = useMemo(
    () => meta?.coins.find(c => c.coin === coin) ?? null,
    [meta, coin]
  )

  // The requested window: anchored to the coin's LAST available fill (not the
  // wall clock), clamped to its first — ranges over what actually exists.
  const window_ = useMemo(() => {
    if (!coinInfo) return null
    const range = RANGES.find(r => r.key === rangeKey) ?? RANGES[3]
    const to = coinInfo.to
    const from = range.ms === Infinity ? coinInfo.from : Math.max(coinInfo.from, to - range.ms)
    return { from, to }
  }, [coinInfo, rangeKey])

  // --- Fills + candles, loaded once per (coin, window, interval) ------------
  useEffect(() => {
    if (!coin || !window_) return
    let dead = false
    setLoading(true)
    setDataError(null)
    setCandlesRes(null)

    const run = async () => {
      const fillsRes = await fetch(`/api/replay/${address}/fills?coin=${encodeURIComponent(coin)}`, {
        cache: 'no-store',
      })
      const fillsBody = await fillsRes.json()
      if (dead) return
      if (!fillsRes.ok) throw new Error(fillsBody?.error ?? `fills error ${fillsRes.status}`)
      const allFills = (fillsBody.fills ?? []) as RFill[]
      setFillsMidPosition(Boolean(fillsBody.starts_mid_position))

      // Pad the window so the entry bar has context, then pick the finest
      // interval the ladder can honestly serve at a sane bar count. The
      // server re-checks and refuses anything dishonest.
      const span = window_.to - window_.from
      const from = Math.max(window_.from - Math.max(span * 0.03, 60_000), 0)
      const to = Math.min(window_.to + Math.max(span * 0.02, 60_000), Date.now())

      const candidates = pickedInterval
        ? [pickedInterval]
        : CANDLE_INTERVALS.filter(([iv, ms]) => {
            const bars = (to - from) / ms
            return bars <= TARGET_BARS && bars >= 10
          }).map(([iv]) => iv)
      if (!pickedInterval && candidates.length === 0) {
        // Very short or very long spans: fall back to whatever fits the cap.
        for (const [iv, ms] of CANDLE_INTERVALS) {
          if ((to - from) / ms <= MAX_BARS) {
            candidates.push(iv)
            break
          }
        }
      }

      let res: CandlesRes | null = null
      let lastErr = 'no interval can serve this window'
      for (const iv of candidates) {
        const url = `/api/replay/candles?coin=${encodeURIComponent(coin)}&interval=${iv}&from=${Math.floor(from)}&to=${Math.ceil(to)}`
        const r = await fetch(url, { cache: 'no-store' })
        const body = await r.json()
        if (dead) return
        if (r.ok) {
          res = body as CandlesRes
          break
        }
        lastErr = body?.error ?? `candles error ${r.status}`
      }
      if (!res) throw new Error(lastErr)

      setFills(allFills.filter(f => f.t >= from && f.t <= to))
      setCandlesRes(res)
      at.current = 0
      setAtDisplay(0)
      setEnded(false)
      flashesRef.current = []
      lastCuedBar.current = -1
      // The first play always happens — a replay that opens paused on an
      // empty frame reads as broken. The loop toggle governs what happens
      // at the end.
      setPlaying(true)
    }

    run()
      .catch(err => {
        if (!dead) setDataError(err instanceof Error ? err.message : 'could not load replay data')
      })
      .finally(() => {
        if (!dead) setLoading(false)
      })
    return () => {
      dead = true
    }
  }, [address, coin, window_, pickedInterval])

  const timeline: Timeline | null = useMemo(() => {
    if (!candlesRes || !fills) return null
    return buildTimeline(candlesRes.candles, candlesRes.interval_ms, fills)
  }, [candlesRes, fills])

  const total = timeline?.candles.length ?? 0
  const stepMs = SPEEDS[speedIdx].stepMs

  // --- The paint-and-play loop ---------------------------------------------
  // Drawn imperatively every animation frame (React state only for the DOM
  // figures, throttled) so `max` speed can cross many bars per frame without
  // a render per bar.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !timeline || total === 0 || clipping !== null) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let started = performance.now()
    let startBar = at.current
    let lastSync = 0

    const paint = (bar: number, p: number) => {
      const dpr = window.devicePixelRatio || 1
      const cssW = canvas.clientWidth
      const cssH = canvas.clientHeight
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr)
        canvas.height = Math.round(cssH * dpr)
      }
      drawChart(
        ctx,
        { x: 0, y: 0, w: canvas.width, h: canvas.height },
        {
          candles: timeline.candles,
          events: timeline.events,
          intervalMs: timeline.intervalMs,
          bar,
          p,
          barSpacing: 8 * dpr,
          k: dpr,
        }
      )
      // Restrained wash for recent closes, drawn into the same canvas.
      const now = performance.now()
      flashesRef.current = flashesRef.current.filter(f => now - f.born <= FLASH_MS)
      for (const f of flashesRef.current) {
        const a = f.strength * washAt(now - f.born) * 0.2
        if (a <= 0.004) continue
        const tint = f.win ? '52, 234, 185' : '255, 59, 92'
        const glow = ctx.createRadialGradient(
          canvas.width / 2,
          canvas.height / 2,
          0,
          canvas.width / 2,
          canvas.height / 2,
          canvas.width * 0.6
        )
        glow.addColorStop(0, `rgba(${tint}, ${a})`)
        glow.addColorStop(1, `rgba(${tint}, 0)`)
        ctx.fillStyle = glow
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }
    }

    const crossBar = (bar: number) => {
      const e = timeline.events[bar]
      if (!e) return
      if (e.closedPnl !== 0) {
        flashesRef.current.push({
          born: performance.now(),
          strength: flashStrength(e.closedPnl, timeline.typicalClosePnl),
          win: e.closedPnl > 0,
        })
      }
      if (soundOn && bar !== lastCuedBar.current) {
        // Distinct events in one bar each get a voice; a close split across a
        // dozen fills is still one event to the ear.
        if (e.hasEntry) playCue('entry')
        if (e.hasWinClose) playCue('win')
        if (e.hasLossClose) playCue('loss')
        lastCuedBar.current = bar
      }
    }

    if (!playing) {
      paint(at.current, 1)
      return
    }

    const frame = (now: number) => {
      const exact = startBar + (now - started) / stepMs
      const bar = Math.min(Math.floor(exact), total - 1)
      // Fire events for every bar crossed since the last frame — but cap the
      // cue spam at max speed by letting crossBar dedupe per frame below.
      for (let b = at.current + 1; b <= bar; b++) crossBar(b)
      at.current = bar
      const p = bar >= total - 1 && exact >= total ? 1 : Math.min(exact - bar, 1)
      paint(bar, p)

      if (now - lastSync > 100) {
        lastSync = now
        setAtDisplay(bar)
      }

      if (exact >= total) {
        if (loop) {
          at.current = 0
          startBar = 0
          started = now
          lastCuedBar.current = -1
          raf = requestAnimationFrame(frame)
          return
        }
        setAtDisplay(total - 1)
        setPlaying(false)
        setEnded(true)
        return
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [timeline, total, playing, stepMs, loop, soundOn, clipping])

  // Repaint on resize while paused.
  useEffect(() => {
    const onResize = () => setAtDisplay(v => v) // nudge the effect via state
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // --- Fullscreen -----------------------------------------------------------
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    if (sizeMode === 'full') {
      if (!document.fullscreenElement) void el.requestFullscreen?.().catch(() => setSizeMode('theater'))
    } else if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => undefined)
    }
  }, [sizeMode])
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setSizeMode(m => (m === 'full' ? 'normal' : m))
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // --- Export ---------------------------------------------------------------
  const exportClip = useCallback(async () => {
    if (!timeline || !candlesRes || total < 2) return
    if (!encoders || encoders === 'probing') return
    const exportStep = Math.max(stepMs, 10) // `max` is unwatchable in a file
    const replaySeconds = (total * exportStep) / 1000
    if (replaySeconds + OUTRO_SECONDS > MAX_CLIP_SECONDS) {
      setTooLong(Math.round(replaySeconds + OUTRO_SECONDS))
      return
    }
    setTooLong(null)
    abortClip.current = false
    setClipping(0)
    setPlaying(false)

    const cardUrl = `${location.host}/card/${address}`
    const strip = stripLines(candlesRes, timeline, coin ?? '', fillsMidPosition)
    const flashSchedule = timeline.events
      .map((e, bar) => ({ atMs: bar * exportStep, pnl: e.closedPnl }))
      .filter(f => f.pnl !== 0)

    try {
      const audio = await renderCues(
        cueSchedule(timeline, exportStep),
        replaySeconds + OUTRO_SECONDS
      )
      const replayFrames = Math.ceil(replaySeconds * FPS)
      const frames = replayFrames + OUTRO_SECONDS * FPS
      const lastRealized = timeline.realizedAfter[total - 1] ?? 0
      const windowLabel = `${dayStamp(timeline.candles[0].t)} – ${dayStamp(timeline.candles[total - 1].t)}`

      const { encode } = await loadClip()
      const result = await encode({
        encoders,
        frames,
        fps: FPS,
        audio,
        cancelled: () => abortClip.current,
        onProgress: f => setClipping(f),
        draw: (ctx, i) => {
          const clipMs = Math.min(i / FPS, replaySeconds) * 1000
          const exact = clipMs / exportStep
          const bar = Math.min(Math.floor(exact), total - 1)
          const p = Math.min(exact - bar, 1)
          paintFrame(ctx, {
            chart: {
              candles: timeline.candles,
              events: timeline.events,
              intervalMs: timeline.intervalMs,
              bar,
              p,
              barSpacing: 16,
              k: 2,
            },
            coin: coin ?? '',
            address,
            label: meta?.identity.label ?? null,
            realized: timeline.realizedAfter[bar] ?? 0,
            fillsSoFar: timeline.fillsAfter[bar] ?? 0,
            stripLines: strip,
            watermark: `ALPHALENS · ${location.host}`,
            flashes: flashSchedule
              .filter(f => clipMs - f.atMs >= 0 && clipMs - f.atMs <= FLASH_MS)
              .map(f => ({
                strength: flashStrength(f.pnl, timeline.typicalClosePnl),
                win: f.pnl > 0,
                alpha: washAt(clipMs - f.atMs),
              })),
            outro: i < replayFrames ? 0 : (i - replayFrames + 1) / (OUTRO_SECONDS * FPS),
            final: {
              realized: lastRealized,
              fills: timeline.totalFills - timeline.fillsOutsideWindow,
              windowLabel,
              cardUrl,
            },
          })
        },
      })
      if (result && !abortClip.current) {
        save(result.blob, `alphalens-replay-${coin}-${address.slice(0, 8)}.${result.ext}`)
      }
    } catch (err) {
      // Nothing is saved; the replay goes back to how it was — but the reason
      // lands in the console so a failed export is diagnosable.
      console.error('clip export failed:', err)
    } finally {
      setClipping(null)
    }
  }, [timeline, candlesRes, total, encoders, stepMs, address, coin, meta, fillsMidPosition])

  // --- Derived UI state ------------------------------------------------------
  const realizedNow = timeline?.realizedAfter[Math.min(atDisplay, total - 1)] ?? 0
  const fillsNow = timeline?.fillsAfter[Math.min(atDisplay, total - 1)] ?? 0
  const locked = clipping !== null

  const containerWidth =
    sizeMode === 'normal' ? 'max-w-2xl' : 'max-w-6xl'
  const chartHeight = sizeMode === 'normal' ? 'h-[300px]' : 'h-[420px] md:h-[520px]'

  if (metaError) {
    return (
      <div className="card p-6 text-center max-w-2xl mx-auto">
        <p className="text-sm font-semibold mb-1">Replay unavailable</p>
        <p className="text-xs text-white/40">{metaError}</p>
      </div>
    )
  }
  if (meta && meta.coins.length === 0) {
    return (
      <div className="card p-6 text-center max-w-2xl mx-auto">
        <p className="text-sm font-semibold mb-1">Nothing to replay</p>
        <p className="text-xs text-white/40">{meta.coverage.note}</p>
      </div>
    )
  }

  return (
    <div ref={wrapRef} className={`mx-auto space-y-3 ${containerWidth} ${sizeMode === 'full' ? 'bg-[#0F1A1E] p-3 overflow-y-auto' : ''}`}>
      {/* Header: coin + running realized-PnL ticker */}
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] text-white/40 font-mono tracking-wider">
            {meta?.identity.label ? `${meta.identity.label} · ` : ''}
            {address.slice(0, 8)}…{address.slice(-6)}
          </p>
          <p className="font-mono text-lg font-bold text-[#F5A623]">{coin ?? '—'}</p>
        </div>
        <div className="text-right shrink-0">
          <p
            className={`font-mono text-2xl md:text-3xl font-bold ${realizedNow >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}
          >
            {timeline ? signedUsd(realizedNow) : '—'}
          </p>
          <p className="text-[9px] text-white/40 uppercase tracking-wider">
            realized PnL · {fillsNow} fills · exchange figures
          </p>
        </div>
      </div>

      {/* Chart */}
      <div className="relative card overflow-hidden">
        <canvas ref={canvasRef} className={`w-full ${chartHeight} block`} />
        {(loading || !timeline) && !dataError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0F1A1E]">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/[0.12] border-t-[#34EAB9]" />
            <p className="text-[10px] text-white/40 uppercase tracking-wider">
              reading this wallet&rsquo;s fills and the tape they landed on
            </p>
          </div>
        )}
        {dataError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0F1A1E] p-6 text-center">
            <p className="text-[11px] font-semibold text-[#FF3B5C] uppercase tracking-wider">
              could not draw this replay
            </p>
            <p className="text-[11px] text-white/40 leading-relaxed max-w-md">{dataError}</p>
          </div>
        )}
        {!dataError && !loading && timeline && total < 2 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0F1A1E] p-6 text-center">
            <p className="text-[11px] font-semibold text-[#F5A623] uppercase tracking-wider">
              no tape for this window
            </p>
            <p className="text-[11px] text-white/40 leading-relaxed max-w-md">
              The chosen source holds{' '}
              {candlesRes
                ? `${candlesRes.coverage.bars} of ${candlesRes.coverage.window_bars.toLocaleString()} possible ${candlesRes.interval} bars`
                : 'no bars'}{' '}
              here. A gap in captured data is shown as missing, never filled — try another range
              or interval.
            </p>
          </div>
        )}
        {ended && timeline && !locked && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0F1A1E]/85 p-6 text-center">
            <p className="text-[10px] text-white/40 uppercase tracking-wider">
              replay finished · realized PnL over this window
            </p>
            <p
              className={`font-mono text-4xl font-bold ${realizedNow >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}
            >
              {signedUsd(timeline.realizedAfter[total - 1] ?? 0)}
            </p>
            <Link
              href={`/card/${address}`}
              className="inline-flex items-center gap-1.5 mt-2 bg-[#34EAB9] text-[#0F1A1E] font-semibold text-[11px] px-3 py-1.5 rounded hover:brightness-110 transition-all"
            >
              Get the grade <ArrowRight size={11} />
            </Link>
            <button
              type="button"
              onClick={() => {
                at.current = 0
                setEnded(false)
                setPlaying(true)
              }}
              className="text-[10px] text-white/40 hover:text-[#34EAB9] transition-colors mt-1"
            >
              watch again
            </button>
          </div>
        )}
        {locked && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0F1A1E]/95 p-6">
            <p className="text-[10px] text-white/40 uppercase tracking-wider">
              rendering clip — every frame carries the coverage strip
            </p>
            <div className="w-full max-w-xs h-1 rounded-full bg-white/[0.08] overflow-hidden">
              <div
                className="h-full bg-[#34EAB9] transition-[width] duration-150"
                style={{ width: `${Math.round((clipping ?? 0) * 100)}%` }}
              />
            </div>
            <button
              type="button"
              onClick={() => {
                abortClip.current = true
              }}
              className="text-[10px] text-white/40 hover:text-[#FF3B5C] uppercase tracking-wider"
            >
              cancel
            </button>
          </div>
        )}
      </div>

      {/* Granularity / coverage strip — always visible, and inside every exported frame */}
      {candlesRes && timeline && (
        <div className="card px-3 py-2">
          {stripLines(candlesRes, timeline, coin ?? '', fillsMidPosition).map((line, i) => (
            <p key={i} className="text-[10px] text-white/45 font-mono leading-relaxed">
              {line}
            </p>
          ))}
        </div>
      )}

      {/* Transport */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={locked || !timeline}
          onClick={() => {
            if (ended) {
              at.current = 0
              setEnded(false)
            }
            setPlaying(p => !p)
          }}
          aria-label={playing ? 'pause' : 'play'}
          className="inline-flex items-center justify-center min-h-[36px] min-w-[44px] rounded border border-[#34EAB9]/50 bg-[#34EAB9]/10 text-[#34EAB9] hover:bg-[#34EAB9]/20 disabled:opacity-40"
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(total - 1, 0)}
          value={Math.min(atDisplay, Math.max(total - 1, 0))}
          disabled={locked || !timeline}
          onChange={e => {
            setPlaying(false)
            setEnded(false)
            at.current = Number(e.target.value)
            setAtDisplay(Number(e.target.value))
          }}
          className="flex-1 min-w-[120px] accent-[#34EAB9]"
          aria-label="scrub the replay"
        />
        <span className="font-mono text-[10px] text-white/40 shrink-0">
          {total ? Math.min(atDisplay, total - 1) + 1 : 0}/{total}
        </span>
      </div>

      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-1.5">
        {SPEEDS.map((s, i) => (
          <button
            key={s.label}
            type="button"
            disabled={locked}
            onClick={() => setSpeedIdx(i)}
            className={`min-h-[30px] px-2 rounded border font-mono text-[10px] uppercase transition-colors ${
              speedIdx === i
                ? 'border-[#34EAB9]/50 bg-[#34EAB9]/10 text-[#34EAB9]'
                : 'border-white/[0.12] text-white/40 hover:text-white/70'
            }`}
          >
            {s.label}
          </button>
        ))}
        <button
          type="button"
          disabled={locked}
          onClick={() => setLoop(l => !l)}
          title="Loop: start over at the end"
          className={`inline-flex items-center min-h-[30px] px-2 rounded border font-mono text-[10px] uppercase transition-colors ${
            loop
              ? 'border-[#34EAB9]/50 bg-[#34EAB9]/10 text-[#34EAB9]'
              : 'border-white/[0.12] text-white/40 hover:text-white/70'
          }`}
        >
          <Repeat size={11} />
        </button>
        <button
          type="button"
          disabled={locked}
          onClick={() => {
            const next = !soundOn
            setSoundOn(next)
            if (next) prepareSound() // decoding needs a user gesture; this is one
          }}
          title={
            soundOn
              ? 'Mute'
              : 'Sound: a blip per entry, a rise per profitable close, a low tone per losing close'
          }
          className={`inline-flex items-center min-h-[30px] px-2 rounded border font-mono text-[10px] uppercase transition-colors ${
            soundOn
              ? 'border-[#34EAB9]/50 bg-[#34EAB9]/10 text-[#34EAB9]'
              : 'border-white/[0.12] text-white/40 hover:text-white/70'
          }`}
        >
          {soundOn ? <Volume2 size={11} /> : <VolumeX size={11} />}
        </button>
        <div className="flex gap-1 ml-auto">
          {(
            [
              ['normal', <Minimize2 key="n" size={11} />, 'Normal'],
              ['theater', <RectangleHorizontal key="t" size={11} />, 'Theater'],
              ['full', <Maximize2 key="f" size={11} />, 'Fullscreen'],
            ] as const
          ).map(([mode, icon, title]) => (
            <button
              key={mode}
              type="button"
              disabled={locked}
              title={title}
              onClick={() => setSizeMode(mode)}
              className={`inline-flex items-center min-h-[30px] px-2 rounded border transition-colors ${
                sizeMode === mode
                  ? 'border-[#34EAB9]/50 bg-[#34EAB9]/10 text-[#34EAB9]'
                  : 'border-white/[0.12] text-white/40 hover:text-white/70'
              }`}
            >
              {icon}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={!timeline || total < 2 || locked || !encoders || encoders === 'probing'}
          onClick={() => void exportClip()}
          title={
            encoders === 'probing'
              ? 'Checking what this browser can encode'
              : encoders
                ? `Render 1920×1080 with sound and save as ${encoders.ext.toUpperCase()}`
                : 'This browser cannot encode video (WebCodecs missing — older Safari). Use the share image instead.'
          }
          className="inline-flex items-center gap-1.5 min-h-[30px] px-2.5 rounded border border-[#34EAB9]/50 bg-[#34EAB9]/10 font-mono text-[10px] text-[#34EAB9] uppercase hover:bg-[#34EAB9]/20 disabled:opacity-40"
        >
          <Download size={11} /> export clip
        </button>
      </div>

      {/* Export caveats, stated honestly */}
      {encoders === null && (
        <p className="text-[10px] text-white/40 leading-relaxed">
          This browser cannot encode video (WebCodecs is missing — typically older Safari; Safari
          16.4+ and Chrome work). The{' '}
          <a
            href={`/replay/${address}/opengraph-image`}
            className="text-[#34EAB9] hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            share image
          </a>{' '}
          is the fallback.
        </p>
      )}
      {encoders && encoders !== 'probing' && encoders.ext === 'webm' && clipping === null && (
        <p className="text-[10px] text-white/40">
          This browser records WebM (no MP4/AAC — typically Firefox); X does not accept WebM.
          Chrome and Safari save MP4 directly.
        </p>
      )}
      {tooLong !== null && clipping === null && (
        <p className="text-[10px] text-[#F5A623]">
          That clip would run {tooLong}s, past the {MAX_CLIP_SECONDS}s ceiling — the whole file is
          held in memory while it is written. Raise the speed or narrow the range and it fits.
        </p>
      )}

      {/* Coin + range pickers */}
      {meta && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[9px] text-white/35 uppercase tracking-wider w-full sm:w-auto">
              coin
            </span>
            {meta.coins.slice(0, 10).map(c => (
              <button
                key={c.coin}
                type="button"
                disabled={locked}
                onClick={() => {
                  setCoin(c.coin)
                  setPickedInterval(null)
                }}
                className={`min-h-[30px] px-2 rounded border font-mono text-[10px] transition-colors ${
                  coin === c.coin
                    ? 'border-[#F5A623]/50 bg-[#F5A623]/10 text-[#F5A623]'
                    : 'border-white/[0.12] text-white/40 hover:text-white/70'
                }`}
                title={`${c.fills.toLocaleString()} fills, ${dayStamp(c.from)} – ${dayStamp(c.to)}`}
              >
                {c.coin}
                <span className="ml-1 text-white/30">{c.fills}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[9px] text-white/35 uppercase tracking-wider w-full sm:w-auto">
              range
            </span>
            {RANGES.map(r => (
              <button
                key={r.key}
                type="button"
                disabled={locked}
                onClick={() => {
                  setRangeKey(r.key)
                  setPickedInterval(null)
                }}
                className={`min-h-[30px] px-2 rounded border font-mono text-[10px] uppercase transition-colors ${
                  rangeKey === r.key
                    ? 'border-[#34EAB9]/50 bg-[#34EAB9]/10 text-[#34EAB9]'
                    : 'border-white/[0.12] text-white/40 hover:text-white/70'
                }`}
              >
                {r.key === 'all' ? 'all available' : `last ${r.key}`}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[9px] text-white/35 uppercase tracking-wider w-full sm:w-auto">
              bars
            </span>
            {(candlesRes?.intervals ?? defaultIntervalOptions(window_)).map(opt => (
              <button
                key={opt.interval}
                type="button"
                disabled={locked || !opt.available}
                onClick={() => setPickedInterval(opt.interval)}
                title={
                  opt.available
                    ? opt.source === 'store'
                      ? 'Served from our captured 1m tape'
                      : 'Served from the exchange'
                    : (opt.reason ?? 'not honestly servable for this window')
                }
                className={`min-h-[30px] px-2 rounded border font-mono text-[10px] uppercase transition-colors disabled:opacity-35 disabled:line-through ${
                  candlesRes?.interval === opt.interval
                    ? 'border-[#34EAB9]/50 bg-[#34EAB9]/10 text-[#34EAB9]'
                    : 'border-white/[0.12] text-white/40 hover:text-white/70'
                }`}
              >
                {opt.interval}
              </button>
            ))}
            <span className="text-[9px] text-white/30 leading-relaxed">
              greyed intervals cannot honestly serve this window — we never resample
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

/** The coverage/granularity strip, one place — shown on the page and painted
 *  into every exported frame, so receipts travel inside the clip. */
function stripLines(
  c: CandlesRes,
  tl: Timeline,
  coin: string,
  midPosition: boolean
): string[] {
  const gaps =
    c.coverage.internal_gaps > 0
      ? `${c.coverage.internal_gaps} gaps (largest ${durationLabel(c.coverage.largest_internal_gap_ms)}) — drawn, not bridged`
      : 'no internal gaps'
  const outside =
    tl.fillsOutsideWindow > 0
      ? ` · ${tl.fillsOutsideWindow} fill${tl.fillsOutsideWindow === 1 ? '' : 's'} outside candle coverage`
      : ''
  const mid = midPosition ? ' · history starts mid-position (partial picture)' : ''
  return [
    `${coin} · ${c.interval} bars · ${c.source === 'store' ? 'AlphaLens captured tape' : 'exchange candles'} · ${c.coverage.bars.toLocaleString()} of ${c.coverage.window_bars.toLocaleString()} possible bars · ${gaps}`,
    `${dayStamp(c.from)} – ${dayStamp(c.to)} · ${tl.totalFills.toLocaleString()} fills at exchange-exact prices${outside}${mid}`,
  ]
}

/** Before the first candles response lands, grey the picker from the ladder
 *  alone (client-side estimate; the server's answer replaces it). */
function defaultIntervalOptions(
  window_: { from: number; to: number } | null
): IntervalOption[] {
  return CANDLE_INTERVALS.map(([interval, ms]) => {
    const ok = window_ ? window_.from >= retentionStart(interval) : false
    return {
      interval,
      interval_ms: ms,
      available: ok,
      source: ok ? 'exchange' : null,
      reason: ok ? null : 'outside the exchange retention ladder for this window',
    }
  })
}
