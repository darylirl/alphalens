/**
 * Server-side replay-doc builder (replay-doc.v1): the build-once half of
 * build-once-serve-forever. One call loads the wallet's real fills (paged),
 * detects episodes with the same detector the player used to run in the
 * browser, resolves the requested range to a concrete window, fetches honest
 * candles through the retention ladder, and serializes the compact document
 * the player rolls from.
 *
 * Nothing here invents data: fills and candles come from the same sources
 * the live routes serve, the coverage blocks travel inside the doc, and a
 * range or interval that cannot be honestly served is refused with the
 * reason — never padded, resampled or silently narrowed.
 */

import { loadWalletFills, type FillsWindow } from '@/lib/wallet-data/fills'
import { loadCandles, INTERVAL_MS } from '@/lib/wallet-data/candles'
import { detectEpisodes, defaultEpisode, summarize, type Episode } from './episodes'
import { coarsen, buildTimeline, type RFill } from './engine'
import { paceCandidates } from './ladder'
import {
  REPLAY_DOC_SCHEMA,
  DOC_MAX_BARS,
  rangeKey,
  encodeCandles,
  encodeFills,
  encodeEpisodes,
  type DocRange,
  type ReplayDoc,
  type WireCoin,
} from './docspec'
import type { Fill } from '@/lib/hyperliquid/types'

export interface DocRequest {
  /** '' = pick the wallet's best coin (the landing / pre-built view). */
  coin: string
  range: DocRange
  /** 'auto' = pace from the window; otherwise a ladder interval. */
  interval: string
}

export interface BuildProgress {
  phase: 'fills' | 'episodes' | 'candles' | 'assemble'
  /** Real counts only — what has actually been loaded or computed so far. */
  detail: Record<string, number | string>
}

export interface BuiltDoc {
  doc: ReplayDoc
  source: 'store' | 'exchange'
  /** Newest fill in the doc's scope (tid + ISO time); null when no fills. */
  lastFillId: number | null
  builtThrough: string | null
  fillCount: number
  buildMs: number
}

/** A request the data cannot serve (unknown coin, vanished episode, refused
 *  interval). The route reports the reason as a 4xx, never a fake doc. */
export class DocRefusal extends Error {}

function toRFill(f: Fill): RFill {
  const start = parseFloat(f.startPosition)
  return {
    t: f.time,
    px: Number(f.px),
    sz: Number(f.sz),
    side: f.side,
    dir: f.dir,
    pnl: Number(f.closedPnl) || 0,
    fee: Number(f.fee) || 0,
    start: Number.isFinite(start) ? start : null,
  }
}

/** The same coin ranking the meta API used: coins whose top episode is a
 *  complete round trip first, then by |PnL|, falling back to most-traded. */
function pickDefaultCoin(
  byCoin: Map<string, Fill[]>,
  episodesByCoin: Map<string, Episode[]>
): string | null {
  const coins = [...byCoin.keys()]
  if (coins.length === 0) return null
  const ranked = coins
    .map(coin => ({ coin, top: defaultEpisode(episodesByCoin.get(coin) ?? []) }))
    .filter(c => c.top)
    .sort((a, b) => {
      const aPartial = a.top!.openBeforeCoverage || a.top!.openAtEnd
      const bPartial = b.top!.openBeforeCoverage || b.top!.openAtEnd
      if (aPartial !== bPartial) return aPartial ? 1 : -1
      return Math.abs(b.top!.pnl) - Math.abs(a.top!.pnl)
    })
  if (ranked[0]) return ranked[0].coin
  return coins.sort((a, b) => (byCoin.get(b)?.length ?? 0) - (byCoin.get(a)?.length ?? 0))[0]
}

/** Running position after each bar, walked from the fills' own start
 *  positions where the exchange reports them (never mark-priced). */
function positionSeries(
  candles: { t: number }[],
  intervalMs: number,
  fills: RFill[]
): number[] {
  const posAfterFill: number[] = []
  let pos = 0
  for (const f of fills) {
    const before = f.start !== null && Number.isFinite(f.start) ? f.start : pos
    pos = before + (f.side === 'B' ? f.sz : -f.sz)
    posAfterFill.push(pos)
  }
  const prePos = fills.length && fills[0].start !== null ? fills[0].start : 0

  const out: number[] = []
  let fi = -1
  for (let b = 0; b < candles.length; b++) {
    const barEnd = candles[b].t + intervalMs
    while (fi + 1 < fills.length && fills[fi + 1].t < barEnd) fi++
    out.push(fi >= 0 ? posAfterFill[fi] : prePos)
  }
  return out
}

/** How far around a curated episode window fills are loaded. Far wider than
 *  the 10-minute episode-merge gap, so the pinned episode's boundaries detect
 *  identically to a full-history load; far narrower than "everything", so a
 *  famous build on a hyperactive wallet stays bounded. */
export const CURATED_WINDOW_PAD_MS = 48 * 3_600_000

export async function buildReplayDoc(
  address: string,
  req: DocRequest,
  onProgress?: (p: BuildProgress) => void,
  opts: {
    /** Load fills only around this window (curated famous episodes — the
     *  episode is closed history with a known span). Padded by
     *  CURATED_WINDOW_PAD_MS on each side before loading. */
    window?: FillsWindow
    /** Curated entries only: read this tape instead of the source the
     *  wallet's cohort membership would pick. See loadWalletFills. */
    forceSource?: 'store' | 'exchange'
  } = {}
): Promise<BuiltDoc> {
  const t0 = Date.now()
  const progress = (phase: BuildProgress['phase'], detail: BuildProgress['detail']) =>
    onProgress?.({ phase, detail })

  progress('fills', { fills: 0 })
  const { fills, coverage, isCohort, wallet, gapCoins } = await loadWalletFills(address, {
    coin: req.coin || undefined,
    onPage: n => progress('fills', { fills: n }),
    window: opts.window
      ? {
          fromMs: Math.max(opts.window.fromMs - CURATED_WINDOW_PAD_MS, 1),
          toMs: opts.window.toMs + CURATED_WINDOW_PAD_MS,
        }
      : undefined,
    forceSource: opts.forceSource,
  })
  progress('fills', { fills: fills.length })

  const byCoin = new Map<string, Fill[]>()
  for (const f of fills) {
    const held = byCoin.get(f.coin)
    if (held) held.push(f)
    else byCoin.set(f.coin, [f])
  }
  const episodesByCoin = new Map<string, Episode[]>()
  for (const [c, coinFills] of byCoin) {
    episodesByCoin.set(c, detectEpisodes(coinFills.map(toRFill)))
  }
  progress('episodes', {
    coins: byCoin.size,
    episodes: [...episodesByCoin.values()].reduce((s, e) => s + e.length, 0),
  })

  // Cross-coin summary travels only in the default doc: coin-scoped builds
  // load one coin's fills and cannot honestly summarize the others.
  const coinsSummary: WireCoin[] | null = req.coin
    ? null
    : [...byCoin.entries()]
        .map(([c, coinFills]) => {
          const s = summarize(episodesByCoin.get(c) ?? [])
          return [
            c,
            coinFills.length,
            coinFills[0].time,
            coinFills[coinFills.length - 1].time,
            s.count,
            s.top ? s.top.pnl : null,
            s.top && (s.top.openBeforeCoverage || s.top.openAtEnd) ? 1 : 0,
          ] as WireCoin
        })
        .sort((a, b) => b[1] - a[1])

  const identity = {
    label: wallet?.label ?? null,
    archetype: wallet?.archetype ?? null,
    cohort_member: isCohort,
  }
  // Scope's newest fill: fills are ascending by time.
  const newest = fills[fills.length - 1] ?? null
  const builtThrough = newest ? new Date(newest.time).toISOString() : null
  const lastFillId = newest && Number.isFinite(newest.tid) ? newest.tid : null

  const base = {
    v: 1 as const,
    schema: REPLAY_DOC_SCHEMA,
    address: address.toLowerCase(),
    requested: { coin: req.coin, range: rangeKey(req.range), interval: req.interval },
    identity,
    built_at: new Date().toISOString(),
    built_through: builtThrough,
    fill_count_total: fills.length,
    gap_coins: gapCoins,
    coins: coinsSummary,
  }

  // No fills at all: an honest empty doc — the player renders the coverage
  // note ("no captured fills yet" / "no fills in the exchange window").
  if (fills.length === 0) {
    return {
      doc: {
        ...base,
        resolved: null,
        starts_mid_position: false,
        coverage: { fills: coverage, candles: null },
        episodes: [],
        intervals: [],
        candles: [],
        dirs: [],
        fills: [],
        series: { realized: [], pos: [], fills_after: [] },
      },
      source: coverage.source,
      lastFillId,
      builtThrough,
      fillCount: fills.length,
      buildMs: Date.now() - t0,
    }
  }

  const coin = req.coin || pickDefaultCoin(byCoin, episodesByCoin)
  if (!coin || !byCoin.has(coin)) {
    throw new DocRefusal(
      req.coin
        ? `No fills for ${req.coin} in the covered window`
        : 'No coin could be resolved from the covered fills'
    )
  }
  const coinFills = byCoin.get(coin)!.map(toRFill)
  const episodes = episodesByCoin.get(coin) ?? []

  // Resolve the range to a concrete window.
  let resolvedRange: DocRange
  let episode: Episode | null = null
  if (req.range === 'default') {
    episode = defaultEpisode(episodes)
    resolvedRange = episode ? { from: episode.from, to: episode.to } : 'all'
  } else if (req.range === 'all') {
    resolvedRange = 'all'
  } else {
    const want = req.range
    episode =
      episodes.find(e => e.from === want.from && e.to === want.to) ??
      episodes.reduce<Episode | null>((best, e) => {
        const overlap = Math.min(e.to, want.to) - Math.max(e.from, want.from)
        if (overlap <= 0) return best
        if (!best) return e
        const bestOverlap = Math.min(best.to, want.to) - Math.max(best.from, want.from)
        return overlap > bestOverlap ? e : best
      }, null)
    if (!episode) {
      throw new DocRefusal(
        'That episode is no longer in the covered fills — the history grew and the round trips re-merged. Reload for the current episode list.'
      )
    }
    resolvedRange = { from: episode.from, to: episode.to }
  }

  const raw =
    resolvedRange === 'all'
      ? { from: coinFills[0].t, to: coinFills[coinFills.length - 1].t }
      : resolvedRange
  const span = Math.max(raw.to - raw.from, 60_000)
  const padFrom = Math.max(raw.from - Math.max(span * 0.06, 120_000), 0)
  const padTo = Math.min(raw.to + Math.max(span * 0.04, 120_000), Date.now())

  // Candles: auto-pacing tries the ladder's best-paced intervals in order;
  // an explicit interval gets exactly one honest attempt.
  const candidates =
    req.interval !== 'auto' ? [req.interval] : paceCandidates(padTo - padFrom)
  if (candidates.length === 0 || (req.interval !== 'auto' && !INTERVAL_MS[req.interval])) {
    throw new DocRefusal(`No candle interval can serve this window`)
  }
  let candlesRes: Awaited<ReturnType<typeof loadCandles>> | null = null
  let lastErr = 'no interval can serve this window'
  for (const iv of candidates) {
    try {
      candlesRes = await loadCandles(coin, iv, Math.floor(padFrom), Math.ceil(padTo))
      break
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err)
      // A refusal moves to the next candidate; a source outage aborts.
      if (!/cap|honestly|resample|window|unknown interval/i.test(lastErr)) throw err
    }
  }
  if (!candlesRes) throw new DocRefusal(lastErr)
  progress('candles', { interval: candlesRes.interval, bars: candlesRes.candles.length })

  // The doc never ships finer than needed: over the cap, merge bars wider
  // (the same coarsen the player zooms with — holes stay holes).
  let served = { candles: candlesRes.candles, intervalMs: candlesRes.interval_ms }
  let coarsenFactor = 1
  while (served.candles.length > DOC_MAX_BARS) {
    coarsenFactor *= 2
    served = coarsen(candlesRes.candles, candlesRes.interval_ms, coarsenFactor)
  }

  // The fills the doc plays: exactly the episode's own, or the padded window
  // for "entire history" — same rule the player enforced, so padding cannot
  // smuggle a neighbouring episode's fills into this story.
  const playFrom = episode ? episode.from : padFrom
  const playTo = episode ? episode.to : padTo
  const playFills = coinFills.filter(f => f.t >= playFrom && f.t <= playTo)

  progress('assemble', { bars: served.candles.length, fills: playFills.length })
  const timeline = buildTimeline(served.candles, served.intervalMs, playFills)
  const pos = positionSeries(served.candles, served.intervalMs, playFills)

  const dirs: string[] = []
  const doc: ReplayDoc = {
    ...base,
    resolved: {
      coin,
      range: resolvedRange === 'all' ? 'all' : rangeKey(resolvedRange),
      from: raw.from,
      to: raw.to,
      padFrom,
      padTo,
      interval: candlesRes.interval,
      interval_ms: served.intervalMs,
      coarsen: coarsenFactor,
    },
    starts_mid_position: gapCoins.includes(coin),
    coverage: {
      fills: coverage,
      candles: {
        source: candlesRes.source,
        bars: candlesRes.coverage.bars,
        window_bars: candlesRes.coverage.window_bars,
        internal_gaps: candlesRes.coverage.internal_gaps,
        largest_internal_gap_ms: candlesRes.coverage.largest_internal_gap_ms,
        note: candlesRes.coverage.note,
      },
    },
    episodes: encodeEpisodes(episodes),
    intervals: candlesRes.intervals,
    candles: encodeCandles(served.candles),
    dirs,
    fills: encodeFills(playFills, dirs),
    series: {
      realized: timeline.realizedAfter,
      pos,
      fills_after: timeline.fillsAfter,
    },
  }

  return {
    doc,
    source: coverage.source,
    lastFillId,
    builtThrough,
    fillCount: fills.length,
    buildMs: Date.now() - t0,
  }
}
