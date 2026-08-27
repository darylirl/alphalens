/**
 * Server-side replay-doc builder (replay-doc.v2): the build-once half of
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

import { loadWalletFills, type WalletRow } from '@/lib/wallet-data/fills'
import {
  loadCandles,
  storeCandleStart,
  INTERVAL_MS,
  MAX_BARS,
  type CandlesResult,
} from '@/lib/wallet-data/candles'
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

/** Bars in the streamed opening window: covers the title card plus ~20s of
 *  1x playback — plenty of runway while the tail loads. */
const HEAD_BARS = 40
/** Below this many remaining bars a split buys nothing; serve in one piece. */
const MIN_TAIL_BARS = 20

/** The doc's candle window, fetched in two slices when a head consumer is
 *  waiting: the opening HEAD_BARS stream first (via onHeadSlice) so playback
 *  can start, then the tail, merged into one series. The tail is pinned to
 *  the head's source — a series must never switch source mid-window — and
 *  the merged coverage is recomputed over the whole series, so the final doc
 *  is identical to a single-fetch build. */
async function loadCandlesSliced(
  coin: string,
  interval: string,
  fromMs: number,
  toMs: number,
  onHeadSlice: ((head: CandlesResult) => void) | null,
  storeStart: Promise<number | null> | null
): Promise<CandlesResult> {
  const ms = INTERVAL_MS[interval]
  if (!ms) throw new Error(`unknown interval '${interval}'`)
  const windowBars = Math.ceil((toMs - fromMs) / ms)
  // The whole window must clear the cap BEFORE any slice is fetched — a
  // per-slice check would let an over-cap explicit interval emit a head and
  // then die on the tail. Same wording as loadCandles' own refusal.
  if (windowBars > MAX_BARS) {
    throw new Error(
      `window holds ${windowBars.toLocaleString()} ${interval} bars, over the ${MAX_BARS.toLocaleString()} cap — pick a coarser interval or a narrower range`
    )
  }
  if (!onHeadSlice || windowBars <= HEAD_BARS + MIN_TAIL_BARS) {
    return loadCandles(coin, interval, fromMs, toMs, { storeStart })
  }

  const headTo = fromMs + HEAD_BARS * ms
  const head = await loadCandles(coin, interval, fromMs, headTo, { storeStart })
  if (head.candles.length >= 2) onHeadSlice(head)
  const tail = await loadCandles(coin, interval, headTo, toMs, {
    forceSource: head.source,
    storeStart,
  })

  const lastHeadT = head.candles.length ? head.candles[head.candles.length - 1].t : -Infinity
  const candles = [...head.candles, ...tail.candles.filter(c => c.t > lastHeadT)]
  let internalGaps = 0
  let largestGap = 0
  for (let i = 1; i < candles.length; i++) {
    const gap = candles[i].t - candles[i - 1].t
    if (gap > ms * 1.5) {
      internalGaps++
      if (gap > largestGap) largestGap = gap
    }
  }
  const first = candles[0]?.t ?? null
  const last = candles.length ? candles[candles.length - 1].t + ms : null
  return {
    ...head,
    to: toMs,
    candles,
    coverage: {
      bars: candles.length,
      window_bars: windowBars,
      missing_leading_ms: first === null ? toMs - fromMs : Math.max(first - fromMs, 0),
      missing_trailing_ms: last === null ? 0 : Math.max(toMs - last, 0),
      internal_gaps: internalGaps,
      largest_internal_gap_ms: largestGap,
      note: head.coverage.note,
    },
  }
}

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

export async function buildReplayDoc(
  address: string,
  req: DocRequest,
  onProgress?: (p: BuildProgress) => void,
  /** Progressive playback (Replay v2.2): called at most once with a PARTIAL
   *  doc holding the opening window of candles and fills, so the player can
   *  roll while the tail loads. Head docs declare partial: true and must
   *  never be cached — the full doc always follows on success. */
  onHead?: (head: ReplayDoc) => void,
  /** The wallets row when the caller already read it — the doc route does,
   *  to decide cohort freshness. Omit when unknown. */
  walletRow?: WalletRow | null
): Promise<BuiltDoc> {
  const t0 = Date.now()
  const progress = (phase: BuildProgress['phase'], detail: BuildProgress['detail']) =>
    onProgress?.({ phase, detail })

  // A coin-scoped request knows its coin before it knows anything else, so
  // the candle ladder's "how far back does our captured tape reach" probe
  // does not have to queue behind the fills load — it only needs the coin.
  // (Started here, awaited inside loadCandles; a rejection is caught there.)
  const storeStartAhead =
    req.coin ? storeCandleStart(req.coin).catch(() => null) : null

  progress('fills', { fills: 0 })
  const { fills, coverage, isCohort, wallet, gapCoins } = await loadWalletFills(address, {
    coin: req.coin || undefined,
    onPage: n => progress('fills', { fills: n }),
    wallet: walletRow,
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
    v: 2 as const,
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

  // The fills the doc plays: exactly the episode's own, or the padded window
  // for "entire history" — same rule the player enforced, so padding cannot
  // smuggle a neighbouring episode's fills into this story. (Known before the
  // candles load, so the streamed head can carry its own fills.)
  const playFrom = episode ? episode.from : padFrom
  const playTo = episode ? episode.to : padTo

  /** The streamed head: the opening candle slice with its own fills, series
   *  and full-window bar count, declared partial. Everything in it is real
   *  and final — the tail only appends. */
  const emitHeadDoc = (head: CandlesResult) => {
    if (!onHead) return
    const headEnd = head.candles[head.candles.length - 1].t + head.interval_ms
    const headFills = coinFills.filter(f => f.t >= playFrom && f.t <= playTo && f.t < headEnd)
    const tlHead = buildTimeline(head.candles, head.interval_ms, headFills)
    const dirsHead: string[] = []
    onHead({
      ...base,
      partial: true,
      resolved: {
        coin,
        range: resolvedRange === 'all' ? 'all' : rangeKey(resolvedRange),
        from: raw.from,
        to: raw.to,
        padFrom,
        padTo,
        interval: head.interval,
        interval_ms: head.interval_ms,
        coarsen: 1,
      },
      starts_mid_position: gapCoins.includes(coin),
      coverage: {
        fills: coverage,
        candles: {
          source: head.source,
          bars: head.candles.length,
          window_bars: Math.ceil((padTo - padFrom) / head.interval_ms),
          internal_gaps: head.coverage.internal_gaps,
          largest_internal_gap_ms: head.coverage.largest_internal_gap_ms,
          note: `${head.coverage.note} — opening window; the remainder is still streaming`,
        },
      },
      episodes: encodeEpisodes(episodes),
      intervals: head.intervals,
      candles: encodeCandles(head.candles),
      dirs: dirsHead,
      fills: encodeFills(headFills, dirsHead),
      series: {
        realized: tlHead.realizedAfter,
        pos: positionSeries(head.candles, head.interval_ms, headFills),
        fills_after: tlHead.fillsAfter,
      },
    })
  }

  // Candles: auto-pacing tries the ladder's best-paced intervals in order;
  // an explicit interval gets exactly one honest attempt. Once a head has
  // been streamed the interval is committed — a later failure aborts the
  // build rather than switching intervals under a playing head.
  const candidates =
    req.interval !== 'auto' ? [req.interval] : paceCandidates(padTo - padFrom)
  if (candidates.length === 0 || (req.interval !== 'auto' && !INTERVAL_MS[req.interval])) {
    throw new DocRefusal(`No candle interval can serve this window`)
  }
  let candlesRes: CandlesResult | null = null
  let lastErr = 'no interval can serve this window'
  let headEmitted = false
  for (const iv of candidates) {
    try {
      candlesRes = await loadCandlesSliced(
        coin,
        iv,
        Math.floor(padFrom),
        Math.ceil(padTo),
        onHead
          ? head => {
              headEmitted = true
              emitHeadDoc(head)
            }
          : null,
        // Only reusable when the request named the coin the doc resolved to;
        // a server-picked coin was unknown when the probe started.
        req.coin === coin ? storeStartAhead : null
      )
      break
    } catch (err) {
      if (headEmitted) throw err
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
