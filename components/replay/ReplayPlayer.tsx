'use client'

/**
 * NOTICE: Portions adapted from trickshot (https://github.com/nathanliow/trickshot)
 * Copyright (c) 2026 Nathan Liow — MIT License. (src/components/WalletReplay.tsx)
 * The single-writer seek model, the rAF-driven bar loop, the flash lifecycle,
 * the coarsen-only zoom, the pacing-from-traded-window idea and the exporter
 * driving the same draw path as the screen come from there — rebuilt against
 * AlphaLens's own fills/candles APIs and canvas chart.
 *
 * Animated playback of a wallet's actual trades on a real candle chart, at
 * exchange-exact execution prices: every marked fill is a real fill at its
 * reported price, and the running PnL is the sum of the exchange's own
 * closedPnl figures — nothing is mark-priced or reconstructed.
 *
 * Replay v2.1 — precomputed documents: the player consumes ONE serialized
 * replay doc per (wallet, coin, range, bar width), served from the
 * replay_docs cache. A cached doc plays as soon as it parses (the title card
 * covers the parse); an uncached first view streams the build's REAL
 * progress — actual fills paged, actual bars loaded — never a spinner over
 * silence. Docs are memoized in sessionStorage so rewatching and episode
 * switching are instant, and playback itself never touches the network: the
 * rAF loop only indexes into the decoded timeline.
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
import {
  buildTimeline,
  coarsen,
  cueSchedule,
  type RCandle,
  type RFill,
  type Timeline,
} from '@/lib/replay/engine'
import {
  decodeCandles,
  decodeEpisodes,
  decodeFills,
  rangeKey,
  type DocEpisode,
  type ReplayDoc,
  type WireCoin,
} from '@/lib/replay/docspec'
import { collectFlashGroups, flashesAt, drawFlashes } from '@/lib/replay/flash'
import { drawChart } from '@/lib/replay/chart'
import { STEP_MS, barLabel } from '@/lib/replay/ladder'
import { play as playCue, prepare as prepareSound, renderCues } from '@/lib/replay/sound'
import {
  signedUsd,
  signedUsdExact,
  usdCompact,
  dayStamp,
  durationLabel,
} from '@/lib/replay/format'
import { paintFrame, type EpisodeCard } from '@/lib/replay/frame'
import { MAX_CLIP_SECONDS, INTRO_SECONDS, OUTRO_SECONDS, FPS } from '@/lib/replay/clipspec'
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

/** With bar formation animated, 8x is already fast — the old 60x/max tiers
 *  reduced the chart to a strobe. */
const SPEEDS = [
  { label: '1x', stepMs: STEP_MS },
  { label: '2x', stepMs: STEP_MS / 2 },
  { label: '4x', stepMs: STEP_MS / 4 },
  { label: '8x', stepMs: STEP_MS / 8 },
] as const

/** Coarser-only bar widths, merged in the browser (trickshot's coarsen). */
const ZOOMS = [1, 2, 4, 8] as const

/** How long the title card holds before playback rolls, in real ms. */
const TITLE_MS = 2_200

/** Episodes listed in the picker before "show all". */
const PICKER_LIMIT = 12

/** Docs bigger than this stay out of sessionStorage (quota is ~5MB). */
const MEMO_MAX_BYTES = 2_000_000

type SizeMode = 'normal' | 'theater' | 'full'
type Phase = 'title' | 'run' | 'end'

/** What the player asks the doc API for. coin '' + range 'default' is the
 *  landing view — the doc the cohort pre-builder keeps warm. */
interface DocReq {
  coin: string
  range: string
  interval: string
}

const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16)

/** The episode's period, tight when it fits inside a day. */
function periodLabel(from: number, to: number): string {
  return dayStamp(from) === dayStamp(to)
    ? `${dayStamp(from)} · ${hhmm(from)}–${hhmm(to)} UTC`
    : `${dayStamp(from)} – ${dayStamp(to)}`
}

// --- sessionStorage memo ----------------------------------------------------
// Rewatch and episode-switch inside a session never refetch: the doc string
// is memoized per (address, coin, range, interval). Guarded — storage can be
// full or blocked, and the replay must work identically without it.

const memoKey = (address: string, r: DocReq) =>
  `alr1:${address.toLowerCase()}:${r.coin}:${r.range}:${r.interval}`

function memoGet(key: string): ReplayDoc | null {
  try {
    const s = sessionStorage.getItem(key)
    return s ? (JSON.parse(s) as ReplayDoc) : null
  } catch {
    return null
  }
}

function memoSet(key: string, doc: ReplayDoc) {
  try {
    const s = JSON.stringify(doc)
    if (s.length <= MEMO_MAX_BYTES) sessionStorage.setItem(key, s)
  } catch {
    // full or blocked storage: the memo is a convenience, never a dependency
  }
}

// --- Doc fetch --------------------------------------------------------------

interface BuildEvent {
  phase: string
  [k: string]: unknown
}

function progressText(ev: BuildEvent): string {
  switch (ev.phase) {
    case 'building':
      return String(ev.note ?? 'building this replay')
    case 'fills':
      return `reading real fills — ${Number(ev.fills ?? 0).toLocaleString()} so far`
    case 'episodes':
      return `detecting round trips — ${Number(ev.episodes ?? 0)} episodes across ${Number(ev.coins ?? 0)} coin${Number(ev.coins ?? 0) === 1 ? '' : 's'}`
    case 'candles':
      return `loading ${String(ev.interval ?? '')} candles — ${Number(ev.bars ?? 0).toLocaleString()} bars`
    case 'assemble':
      return 'assembling the replay document'
    default:
      return 'building this replay'
  }
}

async function fetchDoc(
  address: string,
  r: DocReq,
  onProgress: (text: string) => void
): Promise<{ doc: ReplayDoc; behind: number }> {
  const qs = new URLSearchParams()
  if (r.coin) qs.set('coin', r.coin)
  qs.set('range', r.range)
  if (r.interval !== 'auto') qs.set('interval', r.interval)
  const res = await fetch(`/api/replay/${address}/doc?${qs}`, { cache: 'no-store' })
  const ct = res.headers.get('content-type') ?? ''

  if (ct.includes('ndjson')) {
    // A cold build: the server streams real progress lines, then the doc.
    if (!res.body) throw new Error('the build stream had no body')
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let doc: ReplayDoc | null = null
    let errText: string | null = null
    for (;;) {
      const { done, value } = await reader.read()
      if (value) buf += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const lineStr = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        if (!lineStr.trim()) continue
        let ev: BuildEvent
        try {
          ev = JSON.parse(lineStr) as BuildEvent
        } catch {
          continue
        }
        if (ev.phase === 'done' && ev.doc) doc = ev.doc as ReplayDoc
        else if (ev.phase === 'error') errText = String(ev.error ?? 'could not build this replay')
        else onProgress(progressText(ev))
      }
      if (done) break
    }
    if (errText) throw new Error(errText)
    if (!doc) throw new Error('the build ended without a document')
    return { doc, behind: 0 }
  }

  const body = await res.json()
  if (!res.ok) throw new Error(body?.error ?? `replay doc error ${res.status}`)
  return {
    doc: body as ReplayDoc,
    behind: Number(res.headers.get('x-replay-fills-behind') ?? 0) || 0,
  }
}

// --- Famous-replay end-card grade -------------------------------------------
// A famous replay must end on the receipts: the honest grade with its sample
// size, from the same builder /card renders. Fetched lazily once the doc is
// up (playback runs ≥45s, plenty of time), and the end card renders an honest
// absent state if the fetch has not answered — never a placeholder grade.

interface GradeSummary {
  gradeable: boolean
  overall: string | null
  closedRoundTrips: number
}

/** What the famous page passes down: enough to badge the end card. */
export interface FamousChrome {
  title: string
}

// ---------------------------------------------------------------------------

export function ReplayPlayer({
  address,
  initial,
  famous,
}: {
  address: string
  /** Pinned starting request (famous replays); defaults to the landing doc. */
  initial?: Partial<DocReq>
  /** Present when this view is a curated famous replay. */
  famous?: FamousChrome
}) {
  const [request, setRequest] = useState<DocReq>({
    coin: initial?.coin ?? '',
    range: initial?.range ?? 'default',
    interval: initial?.interval ?? 'auto',
  })
  const [doc, setDoc] = useState<ReplayDoc | null>(null)
  /** Cross-coin picker list: only the default doc carries it, so it is kept
   *  across coin-scoped docs. */
  const [coins, setCoins] = useState<WireCoin[] | null>(null)
  const [behind, setBehind] = useState(0)
  const [buildLine, setBuildLine] = useState<string | null>(null)
  const [dataError, setDataError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(1)

  const [phase, setPhase] = useState<Phase>('title')
  const [playing, setPlaying] = useState(false)
  const [speedIdx, setSpeedIdx] = useState(0)
  const [loop, setLoop] = useState(false)
  const [soundOn, setSoundOn] = useState(false) // research product: muted by default
  const [sizeMode, setSizeMode] = useState<SizeMode>('normal')
  const [showAllEpisodes, setShowAllEpisodes] = useState(false)
  /** Display-side playhead, synced ~10x/s from the loop's ref. */
  const [atDisplay, setAtDisplay] = useState(0)

  const [encoders, setEncoders] = useState<Encoders | null | 'probing'>('probing')
  const [clipping, setClipping] = useState<number | null>(null)
  const [tooLong, setTooLong] = useState<number | null>(null)
  const abortClip = useRef(false)

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const at = useRef(0) // playhead bar, source of truth for the loop
  const lastCuedBar = useRef(-1)

  const [grade, setGrade] = useState<GradeSummary | null>(null)

  // Famous replays fetch the wallet's grade for the end card, lazily — after
  // the doc request is in flight, never blocking first paint. A failed fetch
  // leaves the end card's grade line absent (with the /card link still there);
  // nothing is invented.
  useEffect(() => {
    if (!famous) return
    let dead = false
    void fetch(`/api/card/${address}`, { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then(body => {
        if (dead || !body?.grades) return
        setGrade({
          gradeable: Boolean(body.grades.gradeable),
          overall: typeof body.grades.overall === 'string' ? body.grades.overall : null,
          closedRoundTrips: Number(body.grades.closed_round_trips ?? 0),
        })
      })
      .catch(() => {})
    return () => {
      dead = true
    }
  }, [famous, address])

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

  // --- One doc per view: memo → cache → streamed build ----------------------
  useEffect(() => {
    let dead = false
    setLoading(true)
    setDataError(null)
    setBuildLine(null)

    const apply = (next: ReplayDoc, behindNow: number) => {
      if (dead) return
      setDoc(next)
      setBehind(behindNow)
      if (next.coins) setCoins(next.coins)
      setZoom(1)
      at.current = 0
      setAtDisplay(0)
      lastCuedBar.current = -1
      // Every fresh doc opens on the title card and rolls from there — a
      // replay that opens paused on an empty frame reads as broken.
      setPhase('title')
      setPlaying(false)
      setLoading(false)
    }

    const requestedKey = memoKey(address, request)
    const memoized = memoGet(requestedKey)
    if (memoized) {
      apply(memoized, 0)
      return () => {
        dead = true
      }
    }

    fetchDoc(address, request, text => {
      if (!dead) setBuildLine(text)
    })
      .then(({ doc: next, behind: behindNow }) => {
        if (dead) return
        memoSet(requestedKey, next)
        // Also memoize under the RESOLVED identity, so picking the same
        // episode/coin explicitly later is an instant memo hit.
        if (next.resolved) {
          memoSet(
            memoKey(address, {
              coin: next.resolved.coin,
              range: next.resolved.range,
              interval: request.interval,
            }),
            next
          )
        }
        apply(next, behindNow)
      })
      .catch(err => {
        if (dead) return
        setDataError(err instanceof Error ? err.message : 'could not load the replay')
        setLoading(false)
      })
    return () => {
      dead = true
    }
  }, [address, request])

  // --- Decode the doc -------------------------------------------------------
  const candlesBase: RCandle[] | null = useMemo(
    () => (doc?.resolved ? decodeCandles(doc.candles) : null),
    [doc]
  )
  const fills: RFill[] | null = useMemo(
    () => (doc?.resolved ? decodeFills(doc.fills, doc.dirs) : null),
    [doc]
  )
  const episodes: DocEpisode[] = useMemo(
    () => (doc ? decodeEpisodes(doc.episodes) : []),
    [doc]
  )

  /** The episode this doc plays, resolved by the server; null = whole range. */
  const pickedEpisode: DocEpisode | null = useMemo(() => {
    if (!doc?.resolved || doc.resolved.range === 'all') return null
    const m = /^ep:(\d+)-(\d+)$/.exec(doc.resolved.range)
    if (!m) return null
    const from = Number(m[1])
    const to = Number(m[2])
    return episodes.find(e => e.from === from && e.to === to) ?? null
  }, [doc, episodes])

  /** What the chart actually draws: the doc's bars, browser-merged when the
   *  zoom asks for wider ones. Coarser only — see engine.coarsen. */
  const display = useMemo(
    () =>
      candlesBase && doc?.resolved
        ? coarsen(candlesBase, doc.resolved.interval_ms, zoom)
        : null,
    [candlesBase, doc, zoom]
  )

  const timeline: Timeline | null = useMemo(() => {
    if (!display || !fills) return null
    return buildTimeline(display.candles, display.intervalMs, fills)
  }, [display, fills])

  const flashGroups = useMemo(
    () => (timeline ? collectFlashGroups(timeline) : []),
    [timeline]
  )

  const total = timeline?.candles.length ?? 0
  const stepMs = SPEEDS[speedIdx].stepMs

  /** What the title and end cards say — the episode's own numbers, or the
   *  whole range summed from its episodes. */
  const episodeCard: EpisodeCard | null = useMemo(() => {
    if (!doc?.resolved || !fills) return null
    const coin = doc.resolved.coin
    if (pickedEpisode) {
      const index = episodes.indexOf(pickedEpisode)
      return {
        coin,
        period: periodLabel(pickedEpisode.from, pickedEpisode.to),
        entries: pickedEpisode.entries,
        exits: pickedEpisode.exits,
        maxPosUsd: pickedEpisode.maxPosUsd,
        durationMs: pickedEpisode.to - pickedEpisode.from,
        pnl: pickedEpisode.pnl,
        which: `episode ${index + 1} of ${episodes.length}`,
        caveat: pickedEpisode.openBeforeCoverage
          ? 'position opened before captured history — partial picture'
          : pickedEpisode.openAtEnd
            ? 'position still open at the end of covered fills'
            : '',
      }
    }
    if (fills.length === 0) return null
    const entries = episodes.reduce((s, e) => s + e.entries, 0)
    const exits = episodes.reduce((s, e) => s + e.exits, 0)
    const maxPosUsd = episodes.reduce((s, e) => Math.max(s, e.maxPosUsd), 0)
    return {
      coin,
      period: periodLabel(fills[0].t, fills[fills.length - 1].t),
      entries,
      exits,
      maxPosUsd,
      durationMs: fills[fills.length - 1].t - fills[0].t,
      pnl: fills.reduce((s, f) => s + f.pnl, 0),
      which: 'entire history',
      caveat: doc.starts_mid_position
        ? 'history starts mid-position — partial picture'
        : '',
    }
  }, [doc, fills, pickedEpisode, episodes])

  // --- Title card: hold, then roll ------------------------------------------
  useEffect(() => {
    if (phase !== 'title' || !timeline || total < 2 || clipping !== null) return
    const t = setTimeout(() => {
      setPhase('run')
      setPlaying(true)
    }, TITLE_MS)
    return () => clearTimeout(t)
  }, [phase, timeline, total, clipping])

  // --- The paint-and-play loop ---------------------------------------------
  // Drawn imperatively every animation frame (React state only for the DOM
  // figures, throttled). The forming bar walks its open toward its close with
  // the wicks revealed as it goes — the chart reads as price FORMING.
  // Playback and seeking only index into the decoded timeline: no network.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !timeline || total === 0 || clipping !== null) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let started = performance.now()
    let startBar = at.current
    let lastSync = 0

    const paint = (bar: number, p: number, withCards: boolean) => {
      const dpr = window.devicePixelRatio || 1
      const cssW = canvas.clientWidth
      const cssH = canvas.clientHeight
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr)
        canvas.height = Math.round(cssH * dpr)
      }
      const rect = { x: 0, y: 0, w: canvas.width, h: canvas.height }
      drawChart(ctx, rect, {
        candles: timeline.candles,
        events: timeline.events,
        intervalMs: timeline.intervalMs,
        bar,
        p,
        barSpacing: 8 * dpr,
        k: dpr,
      })
      // Fill announcements — the same painter the exporter uses, driven by
      // the same replay clock, so no fill passes invisibly at any speed.
      // Skipped on the title/end cards, where a frozen card would bleed
      // through the scrim; a paused or scrubbed-to bar still shows its own.
      if (withCards) {
        drawFlashes(ctx, rect, dpr, flashesAt(flashGroups, stepMs, (bar + p) * stepMs))
      }
    }

    const crossBar = (bar: number) => {
      const e = timeline.events[bar]
      if (!e) return
      if (soundOn && bar !== lastCuedBar.current && e.fills.length > 0) {
        // A cue on each flash. Distinct events in one bar each get a voice; a
        // close split across a dozen fills is still one event to the ear.
        if (e.hasEntry) playCue('entry')
        if (e.hasWinClose) playCue('win')
        if (e.hasLossClose) playCue('loss')
        if (!e.hasEntry && !e.hasWinClose && !e.hasLossClose) playCue('entry')
        lastCuedBar.current = bar
      }
    }

    if (!playing) {
      paint(at.current, 1, phase === 'run')
      return
    }

    const frame = (now: number) => {
      const exact = startBar + (now - started) / stepMs
      const bar = Math.min(Math.floor(exact), total - 1)
      for (let b = at.current + 1; b <= bar; b++) crossBar(b)
      at.current = bar
      const p = bar >= total - 1 && exact >= total ? 1 : Math.min(exact - bar, 1)
      paint(bar, p, true)

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
        setPhase('end')
        return
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [timeline, total, playing, stepMs, loop, soundOn, clipping, flashGroups, phase])

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
  // The clip is the episode experience whole: title card, formation, flashes
  // (same painter as the screen), end card — with the coverage strip and
  // watermark on every frame.
  const exportClip = useCallback(async () => {
    if (!timeline || !doc?.resolved || !episodeCard || total < 2) return
    if (!encoders || encoders === 'probing') return
    const exportStep = stepMs
    const replaySeconds = (total * exportStep) / 1000
    const clipSeconds = INTRO_SECONDS + replaySeconds + OUTRO_SECONDS
    if (clipSeconds > MAX_CLIP_SECONDS) {
      setTooLong(Math.round(clipSeconds))
      return
    }
    setTooLong(null)
    abortClip.current = false
    setClipping(0)
    setPlaying(false)

    const cardUrl = `${location.host}/card/${address}`
    const strip = stripLines(doc, timeline, zoom)
    const groups = flashGroups

    try {
      const audio = await renderCues(
        cueSchedule(timeline, exportStep).map(c => ({ ...c, t: c.t + INTRO_SECONDS })),
        clipSeconds
      )
      const introFrames = INTRO_SECONDS * FPS
      const replayFrames = Math.ceil(replaySeconds * FPS)
      const frames = introFrames + replayFrames + OUTRO_SECONDS * FPS
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
          const inIntro = i < introFrames
          const replayMs = inIntro
            ? 0
            : Math.min(((i - introFrames) / FPS) * 1000, replaySeconds * 1000)
          const exact = replayMs / exportStep
          const bar = Math.min(Math.floor(exact), total - 1)
          const p = Math.min(exact - bar, 1)
          // The title card eases in over the first 0.4s, holds, and hands off
          // to the opening bar over the next 0.4s of playback.
          const intro = inIntro
            ? Math.min((i / FPS) / 0.4, 1)
            : Math.max(0, 1 - replayMs / 400)
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
            coin: doc.resolved?.coin ?? '',
            address,
            label: doc.identity.label ?? null,
            realized: timeline.realizedAfter[bar] ?? 0,
            fillsSoFar: timeline.fillsAfter[bar] ?? 0,
            stripLines: strip,
            watermark: `ALPHALENS · ${location.host}`,
            flashes:
              inIntro || i >= introFrames + replayFrames
                ? [] // never through the title or end card scrims
                : flashesAt(groups, exportStep, replayMs),
            intro,
            outro:
              i < introFrames + replayFrames
                ? 0
                : (i - introFrames - replayFrames + 1) / (OUTRO_SECONDS * FPS),
            episode: episodeCard,
            final: {
              fills: timeline.totalFills - timeline.fillsOutsideWindow,
              windowLabel,
              cardUrl,
            },
          })
        },
      })
      if (result && !abortClip.current) {
        save(
          result.blob,
          `alphalens-replay-${doc.resolved.coin}-${address.slice(0, 8)}.${result.ext}`
        )
      }
    } catch (err) {
      // Nothing is saved; the replay goes back to how it was — but the reason
      // lands in the console so a failed export is diagnosable.
      console.error('clip export failed:', err)
    } finally {
      setClipping(null)
    }
  }, [timeline, doc, episodeCard, total, encoders, stepMs, address, zoom, flashGroups])

  // --- Derived UI state ------------------------------------------------------
  const realizedNow = timeline?.realizedAfter[Math.min(atDisplay, total - 1)] ?? 0
  const fillsNow = timeline?.fillsAfter[Math.min(atDisplay, total - 1)] ?? 0
  const locked = clipping !== null
  const rankedEpisodes = useMemo(
    () => [...episodes].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl)),
    [episodes]
  )
  const resolvedCoin = doc?.resolved?.coin ?? null
  const resolvedRange = doc?.resolved?.range ?? 'default'

  const containerWidth = sizeMode === 'normal' ? 'max-w-2xl' : 'max-w-6xl'
  const chartHeight = sizeMode === 'normal' ? 'h-[300px]' : 'h-[420px] md:h-[520px]'

  const restart = useCallback(() => {
    at.current = 0
    setAtDisplay(0)
    lastCuedBar.current = -1
    setPlaying(false)
    setPhase('title')
  }, [])

  if (dataError && !doc) {
    return (
      <div className="card p-6 text-center max-w-2xl mx-auto">
        <p className="text-sm font-semibold mb-1">Replay unavailable</p>
        <p className="text-xs text-white/40">{dataError}</p>
      </div>
    )
  }
  if (doc && !doc.resolved) {
    return (
      <div className="card p-6 text-center max-w-2xl mx-auto">
        <p className="text-sm font-semibold mb-1">Nothing to replay</p>
        <p className="text-xs text-white/40">{doc.coverage.fills.note}</p>
      </div>
    )
  }

  return (
    <div ref={wrapRef} className={`mx-auto space-y-3 ${containerWidth} ${sizeMode === 'full' ? 'bg-[#0F1A1E] p-3 overflow-y-auto' : ''}`}>
      {/* Header: coin + episode left, running realized-PnL ticker right */}
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] text-white/40 font-mono tracking-wider">
            {doc?.identity.label ? `${doc.identity.label} · ` : ''}
            {address.slice(0, 8)}…{address.slice(-6)}
          </p>
          <p className="font-mono text-lg font-bold text-[#F5A623]">
            {resolvedCoin ?? '—'}
            {episodeCard && (
              <span className="ml-2 text-[10px] font-normal text-white/40 uppercase tracking-wider">
                {episodeCard.which}
              </span>
            )}
          </p>
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
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0F1A1E] p-6 text-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/[0.12] border-t-[#34EAB9]" />
            {buildLine ? (
              <>
                <p className="text-[10px] text-white/55 uppercase tracking-wider">
                  building this replay — first view does the work, later views are instant
                </p>
                <p className="text-[10px] text-[#34EAB9]/80 font-mono">{buildLine}</p>
              </>
            ) : (
              <p className="text-[10px] text-white/40 uppercase tracking-wider">
                loading the replay document
              </p>
            )}
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
              {doc?.coverage.candles
                ? `${doc.coverage.candles.bars} of ${doc.coverage.candles.window_bars.toLocaleString()} possible ${doc.resolved?.interval} bars`
                : 'no bars'}{' '}
              here. A gap in captured data is shown as missing, never filled — try another episode
              or interval.
            </p>
          </div>
        )}
        {/* Title card: names the episode, then rolls. */}
        {phase === 'title' && timeline && total >= 2 && !locked && episodeCard && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-[#0A1417]/90 p-6 text-center">
            <p className="text-[10px] text-white/45 uppercase tracking-[0.2em]">
              {episodeCard.which}
            </p>
            <p className="font-mono text-4xl font-extrabold text-[#F5A623]">{episodeCard.coin}</p>
            <p className="font-mono text-[12px] text-white/65">{episodeCard.period}</p>
            <p className="font-mono text-[11px] text-white/55">
              {episodeCard.entries} {episodeCard.entries === 1 ? 'entry' : 'entries'},{' '}
              {episodeCard.exits} {episodeCard.exits === 1 ? 'exit' : 'exits'} ·{' '}
              {durationLabel(episodeCard.durationMs)}
            </p>
            {episodeCard.caveat && (
              <p className="text-[10px] text-[#F5A623]/90">{episodeCard.caveat}</p>
            )}
          </div>
        )}
        {/* End card: the realized result, USD-explicit, with the recap. */}
        {phase === 'end' && timeline && !locked && episodeCard && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0F1A1E]/90 p-6 text-center">
            {famous && (
              <p className="text-[10px] text-[#F5A623] uppercase tracking-[0.2em]">
                {famous.title}
              </p>
            )}
            <p className="text-[10px] text-white/40 uppercase tracking-wider">
              {episodeCard.coin} · {episodeCard.period} · {episodeCard.which}
            </p>
            <p
              className={`font-mono text-4xl md:text-5xl font-extrabold ${episodeCard.pnl >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}
            >
              {signedUsdExact(episodeCard.pnl)}
            </p>
            <p className="text-[9px] text-white/45 uppercase tracking-wider">
              net realized PnL, USD · exchange figures
            </p>
            <p className="font-mono text-[11px] text-white/60">
              {episodeCard.entries} {episodeCard.entries === 1 ? 'entry' : 'entries'} ·{' '}
              {episodeCard.exits} {episodeCard.exits === 1 ? 'exit' : 'exits'} · max position{' '}
              {usdCompact(episodeCard.maxPosUsd)} · {durationLabel(episodeCard.durationMs)}
            </p>
            {episodeCard.caveat && (
              <p className="text-[10px] text-[#F5A623]/90">{episodeCard.caveat}</p>
            )}
            {famous && grade && (
              <p className="font-mono text-[11px] text-white/70 mt-1">
                {grade.gradeable && grade.overall ? (
                  <>
                    report card:{' '}
                    <span
                      className={`font-bold text-[13px] ${
                        grade.overall === 'A' || grade.overall === 'B'
                          ? 'text-[#34EAB9]'
                          : grade.overall === 'C'
                            ? 'text-[#F5A623]'
                            : 'text-[#FF3B5C]'
                      }`}
                    >
                      {grade.overall}
                    </span>
                    {' '}· {grade.closedRoundTrips.toLocaleString()} closed round trips
                  </>
                ) : (
                  <>
                    report card: not enough covered history to grade
                    {grade.closedRoundTrips > 0
                      ? ` (${grade.closedRoundTrips.toLocaleString()} closed round trips)`
                      : ''}
                  </>
                )}
              </p>
            )}
            <Link
              href={`/card/${address}`}
              className="inline-flex items-center gap-1.5 mt-2 bg-[#34EAB9] text-[#0F1A1E] font-semibold text-[11px] px-3 py-1.5 rounded hover:brightness-110 transition-all"
            >
              Get the grade <ArrowRight size={11} />
            </Link>
            <button
              type="button"
              onClick={restart}
              className="text-[10px] text-white/40 hover:text-[#34EAB9] transition-colors mt-1"
            >
              watch again
            </button>
          </div>
        )}
        {locked && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0F1A1E]/95 p-6">
            <p className="text-[10px] text-white/40 uppercase tracking-wider">
              rendering clip — title card, formation, flashes and end card, coverage strip on
              every frame
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
      {doc && timeline && (
        <div className="card px-3 py-2">
          {stripLines(doc, timeline, zoom).map((line, i) => (
            <p key={i} className="text-[10px] text-white/45 font-mono leading-relaxed">
              {line}
            </p>
          ))}
          {behind > 0 && (
            <p className="text-[10px] text-[#F5A623]/80 font-mono leading-relaxed">
              cached document · {behind} newer fill{behind === 1 ? '' : 's'} not yet included —
              refreshes automatically
            </p>
          )}
        </div>
      )}

      {/* Transport */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={locked || !timeline}
          onClick={() => {
            if (phase === 'end') {
              at.current = 0
              setAtDisplay(0)
              lastCuedBar.current = -1
            }
            if (phase !== 'run') setPhase('run')
            setPlaying(p => (phase === 'run' ? !p : true))
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
            setPhase('run')
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
          held in memory while it is written. Raise the speed or widen the bars and it fits.
        </p>
      )}

      {/* Coin, episode, zoom and interval pickers */}
      {doc && (
        <div className="space-y-2">
          {coins && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[9px] text-white/35 uppercase tracking-wider w-full sm:w-auto">
                coin
              </span>
              {coins.slice(0, 10).map(([c, fillCount, from, to, epCount]) => (
                <button
                  key={c}
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    setRequest({ coin: c, range: 'default', interval: 'auto' })
                    setShowAllEpisodes(false)
                  }}
                  className={`min-h-[30px] px-2 rounded border font-mono text-[10px] transition-colors ${
                    resolvedCoin === c
                      ? 'border-[#F5A623]/50 bg-[#F5A623]/10 text-[#F5A623]'
                      : 'border-white/[0.12] text-white/40 hover:text-white/70'
                  }`}
                  title={`${fillCount.toLocaleString()} fills, ${dayStamp(from)} – ${dayStamp(to)} · ${epCount} episodes`}
                >
                  {c}
                  <span className="ml-1 text-white/30">{fillCount}</span>
                </button>
              ))}
            </div>
          )}

          {/* Episode picker: largest |PnL| first, PnL-labelled; the whole
              range stays available as "entire history". */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[9px] text-white/35 uppercase tracking-wider w-full sm:w-auto">
              episode
            </span>
            {(showAllEpisodes ? rankedEpisodes : rankedEpisodes.slice(0, PICKER_LIMIT)).map(ep => {
              const index = episodes.indexOf(ep)
              const active = pickedEpisode === ep
              const partial = ep.openBeforeCoverage || ep.openAtEnd
              return (
                <button
                  key={index}
                  type="button"
                  disabled={locked || !resolvedCoin}
                  onClick={() => {
                    if (!resolvedCoin) return
                    setRequest({
                      coin: resolvedCoin,
                      range: rangeKey({ from: ep.from, to: ep.to }),
                      interval: 'auto',
                    })
                  }}
                  title={`${periodLabel(ep.from, ep.to)} · ${ep.entries} entries, ${ep.exits} exits · ${ep.fills} fills${partial ? ' · partial (position open beyond covered fills)' : ''}`}
                  className={`min-h-[30px] px-2 rounded border font-mono text-[10px] transition-colors ${
                    active
                      ? 'border-[#34EAB9]/50 bg-[#34EAB9]/10 text-[#34EAB9]'
                      : 'border-white/[0.12] text-white/40 hover:text-white/70'
                  }`}
                >
                  #{index + 1}
                  <span className={`ml-1 ${ep.pnl >= 0 ? 'text-[#34EAB9]/80' : 'text-[#FF3B5C]/80'}`}>
                    {signedUsd(ep.pnl)}
                  </span>
                  {partial && <span className="ml-1 text-[#F5A623]/80">◐</span>}
                </button>
              )
            })}
            {rankedEpisodes.length > PICKER_LIMIT && (
              <button
                type="button"
                disabled={locked}
                onClick={() => setShowAllEpisodes(s => !s)}
                className="min-h-[30px] px-2 rounded border border-white/[0.12] font-mono text-[10px] text-white/40 hover:text-white/70"
              >
                {showAllEpisodes ? 'fewer' : `+${rankedEpisodes.length - PICKER_LIMIT} more`}
              </button>
            )}
            <button
              type="button"
              disabled={locked || !resolvedCoin}
              onClick={() => {
                if (!resolvedCoin) return
                setRequest({ coin: resolvedCoin, range: 'all', interval: 'auto' })
              }}
              className={`min-h-[30px] px-2 rounded border font-mono text-[10px] uppercase transition-colors ${
                resolvedRange === 'all'
                  ? 'border-[#34EAB9]/50 bg-[#34EAB9]/10 text-[#34EAB9]'
                  : 'border-white/[0.12] text-white/40 hover:text-white/70'
              }`}
            >
              entire history
            </button>
            {doc && episodes.length === 0 && (
              <span className="text-[9px] text-white/30">
                no round trips detected in the covered fills
              </span>
            )}
          </div>

          {/* Zoom: coarser bars only, merged in the browser — a finer bar is a
              different series and goes back through the ladder. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[9px] text-white/35 uppercase tracking-wider w-full sm:w-auto">
              zoom
            </span>
            {ZOOMS.map(z => (
              <button
                key={z}
                type="button"
                disabled={locked || !candlesBase}
                onClick={() => {
                  if (!candlesBase || !display || !doc?.resolved) return
                  // Hold the moment, not the index: wider bars mean fewer of
                  // them, so keeping `at` would jump the replay back in time.
                  const now = display.candles[Math.min(at.current, display.candles.length - 1)]?.t ?? 0
                  const next = coarsen(candlesBase, doc.resolved.interval_ms, z)
                  const i = next.candles.findIndex(c => c.t + next.intervalMs > now)
                  setZoom(z)
                  at.current = i < 0 ? Math.max(next.candles.length - 1, 0) : i
                  setAtDisplay(at.current)
                }}
                title={doc?.resolved ? `${barLabel(doc.resolved.interval_ms * z)} bars` : undefined}
                className={`min-h-[30px] px-2 rounded border font-mono text-[10px] uppercase transition-colors ${
                  zoom === z
                    ? 'border-[#34EAB9]/50 bg-[#34EAB9]/10 text-[#34EAB9]'
                    : 'border-white/[0.12] text-white/40 hover:text-white/70'
                }`}
              >
                {doc?.resolved ? barLabel(doc.resolved.interval_ms * z) : `${z}x`}
              </button>
            ))}
            <span className="text-[9px] text-white/30 leading-relaxed">
              wider bars are merged in the browser from the honest series — coarser only
            </span>
          </div>

          {/* Granularity strip: which base intervals can honestly serve this
              window. Auto-paced to play ~45–90s at 1x; pick to override. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[9px] text-white/35 uppercase tracking-wider w-full sm:w-auto">
              bars
            </span>
            {doc.intervals.map(opt => (
              <button
                key={opt.interval}
                type="button"
                disabled={locked || !opt.available || !resolvedCoin}
                onClick={() => {
                  if (!resolvedCoin) return
                  setRequest({ coin: resolvedCoin, range: resolvedRange, interval: opt.interval })
                }}
                title={
                  opt.available
                    ? opt.source === 'store'
                      ? 'Served from our captured 1m tape'
                      : 'Served from the exchange'
                    : (opt.reason ?? 'not honestly servable for this window')
                }
                className={`min-h-[30px] px-2 rounded border font-mono text-[10px] uppercase transition-colors disabled:opacity-35 disabled:line-through ${
                  doc.resolved?.interval === opt.interval
                    ? 'border-[#34EAB9]/50 bg-[#34EAB9]/10 text-[#34EAB9]'
                    : 'border-white/[0.12] text-white/40 hover:text-white/70'
                }`}
              >
                {opt.interval}
              </button>
            ))}
            <span className="text-[9px] text-white/30 leading-relaxed">
              auto-paced for a 45–90s play at 1x · greyed intervals cannot honestly serve this
              window — we never resample
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

/** The coverage/granularity strip, one place — shown on the page and painted
 *  into every exported frame, so receipts travel inside the clip. */
function stripLines(doc: ReplayDoc, tl: Timeline, zoom: number): string[] {
  const r = doc.resolved
  const c = doc.coverage.candles
  if (!r || !c) return []
  const gaps =
    c.internal_gaps > 0
      ? `${c.internal_gaps} gaps (largest ${durationLabel(c.largest_internal_gap_ms)}) — drawn, not bridged`
      : 'no internal gaps'
  const mergeFactor = r.coarsen * zoom
  const merge = mergeFactor > 1 ? ` · ×${mergeFactor} bar-merge (coarser only)` : ''
  const outside =
    tl.fillsOutsideWindow > 0
      ? ` · ${tl.fillsOutsideWindow} fill${tl.fillsOutsideWindow === 1 ? '' : 's'} outside candle coverage`
      : ''
  const mid = doc.starts_mid_position ? ' · history starts mid-position (partial picture)' : ''
  return [
    `${r.coin} · ${r.interval} bars · ${c.source === 'store' ? 'AlphaLens captured tape' : 'exchange candles'} · ${c.bars.toLocaleString()} of ${c.window_bars.toLocaleString()} possible bars · ${gaps}${merge}`,
    `${dayStamp(r.padFrom)} – ${dayStamp(r.padTo)} · ${tl.totalFills.toLocaleString()} fills at exchange-exact prices${outside}${mid}`,
  ]
}
