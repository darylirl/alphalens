import { getSupabase } from '@/lib/db/supabase'

// Candles for the replay, from the two honest sources:
//
// - The exchange's candleSnapshot API, which retains roughly 5000 bars per
//   interval (measured: 1m → 3.5 d, 5m → 17.4 d, 15m → 52 d, 1h → 208 d,
//   4h → 833 d, 1d → years). The ladder below mirrors
//   verify-service/lib/market.mjs, the canonical implementation.
// - Our captured 1m tape (candles_1m via the verify_tape_prices RPC), which
//   outlives the exchange's 3.5-day 1m window for coins in capture scope,
//   from the moment capture started.
//
// An interval whose source cannot reach the requested window is refused with
// the reason — never served resampled, interpolated, or silently narrowed.
// Missing bars inside a served window stay missing: the response reports how
// many are absent and the largest internal gap, and the chart draws the gap.

import {
  RETENTION_BARS,
  CANDLE_INTERVALS,
  INTERVAL_MS,
  retentionStart,
  MAX_BARS,
} from '@/lib/replay/ladder'

export { RETENTION_BARS, CANDLE_INTERVALS, INTERVAL_MS, retentionStart, MAX_BARS }

export interface ReplayCandle {
  t: number // bar open, ms
  o: number
  h: number
  l: number
  c: number
  v: number
}

export interface IntervalOption {
  interval: string
  interval_ms: number
  available: boolean
  source: 'exchange' | 'store' | null
  /** Why the interval cannot be honestly served for this window, when it cannot. */
  reason: string | null
}

export interface CandlesResult {
  coin: string
  interval: string
  interval_ms: number
  source: 'exchange' | 'store'
  from: number
  to: number
  candles: ReplayCandle[]
  coverage: {
    bars: number
    /** Bars the window could hold at this interval — an upper bound, since a
     *  coin need not print every bar. */
    window_bars: number
    missing_leading_ms: number
    missing_trailing_ms: number
    internal_gaps: number
    largest_internal_gap_ms: number
    note: string
  }
  intervals: IntervalOption[]
}

const fmtDays = (ms: number) => `${(ms / 86_400_000).toFixed(1)} days`

/** Earliest stored 1m bar for a coin, or null when none captured. Bounded:
 *  one row off the (coin, t) primary key. */
export async function storeCandleStart(coin: string): Promise<number | null> {
  try {
    const supabase = getSupabase()
    const { data } = await supabase
      .from('candles_1m')
      .select('t')
      .eq('coin', coin)
      .order('t', { ascending: true })
      .limit(1)
    const t = data?.[0]?.t
    return t ? Date.parse(t) : null
  } catch {
    return null
  }
}

/**
 * Which intervals can honestly serve [from, to] for this coin, and from
 * which source. Exchange first (its bars are the complete official series);
 * our stored 1m tape extends only the 1m rung further back.
 */
export function intervalOptions(
  fromMs: number,
  storeStartMs: number | null,
  now = Date.now()
): IntervalOption[] {
  return CANDLE_INTERVALS.map(([interval, ms]) => {
    const exchangeStart = retentionStart(interval, now)
    if (fromMs >= exchangeStart) {
      return { interval, interval_ms: ms, available: true, source: 'exchange' as const, reason: null }
    }
    if (interval === '1m' && storeStartMs !== null && fromMs >= storeStartMs) {
      return { interval, interval_ms: ms, available: true, source: 'store' as const, reason: null }
    }
    const reach =
      interval === '1m' && storeStartMs !== null
        ? Math.min(exchangeStart, storeStartMs)
        : exchangeStart
    return {
      interval,
      interval_ms: ms,
      available: false,
      source: null,
      reason:
        `${interval} bars reach back ${fmtDays(now - reach)}` +
        (interval === '1m' && storeStartMs !== null
          ? ' (exchange ~3.5 days, extended by our captured tape)'
          : ` — the exchange retains ~${RETENTION_BARS.toLocaleString()} bars per interval`) +
        '; this window starts earlier. We do not resample coarser data into finer bars.',
    }
  })
}

const HL_URL = 'https://api.hyperliquid.xyz/info'
const HL_CHUNK_BARS = 4000

interface RawHlCandle {
  t: number
  o: string
  h: string
  l: string
  c: string
  v: string
}

async function exchangeCandles(
  coin: string,
  interval: string,
  fromMs: number,
  toMs: number
): Promise<ReplayCandle[]> {
  const ms = INTERVAL_MS[interval]
  const out = new Map<number, ReplayCandle>()
  let cursor = fromMs
  // Chunked walk; each request is bounded at HL_CHUNK_BARS bars.
  for (let i = 0; i < 8 && cursor < toMs; i++) {
    const end = Math.min(cursor + HL_CHUNK_BARS * ms, toMs)
    const res = await fetch(HL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'candleSnapshot',
        req: { coin, interval, startTime: cursor, endTime: end },
      }),
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`candleSnapshot ${res.status}`)
    const batch = (await res.json()) as RawHlCandle[]
    if (Array.isArray(batch)) {
      for (const b of batch) {
        const t = Number(b.t)
        if (!Number.isFinite(t) || t < fromMs || t >= toMs) continue
        out.set(t, {
          t,
          o: parseFloat(b.o),
          h: parseFloat(b.h),
          l: parseFloat(b.l),
          c: parseFloat(b.c),
          v: parseFloat(b.v),
        })
      }
    }
    cursor = end
  }
  return [...out.values()].sort((a, b) => a.t - b.t)
}

interface TapeRow {
  t: string
  o: number
  h: number
  l: number
  c: number
  v: number | null
}

/** Captured 1m bars over a range, paged through the verify_tape_prices RPC.
 *  Missing minutes come back absent — never synthesized. */
async function storeCandles(coin: string, fromMs: number, toMs: number): Promise<ReplayCandle[]> {
  const supabase = getSupabase()
  const PAGE = 1000
  const out: ReplayCandle[] = []
  for (let offset = 0; offset < MAX_BARS + PAGE; offset += PAGE) {
    const { data, error } = await supabase.rpc('verify_tape_prices', {
      p_coin: coin,
      p_from: new Date(fromMs).toISOString(),
      p_to: new Date(toMs).toISOString(),
      p_limit: PAGE,
      p_offset: offset,
    })
    if (error) throw error
    const rows = (data ?? []) as TapeRow[]
    for (const r of rows) {
      out.push({
        t: Date.parse(r.t),
        o: Number(r.o),
        h: Number(r.h),
        l: Number(r.l),
        c: Number(r.c),
        v: r.v === null ? 0 : Number(r.v),
      })
    }
    if (rows.length < PAGE) break
  }
  return out
}

export async function loadCandles(
  coin: string,
  interval: string,
  fromMs: number,
  toMs: number,
  opts: {
    /** Pin the source. Used when a window is fetched in slices (the replay's
     *  progressive head/tail split): a later slice starting inside exchange
     *  retention must not silently switch source mid-series. The pin is still
     *  honesty-checked — a source that cannot reach the slice is refused. */
    forceSource?: 'exchange' | 'store'
  } = {}
): Promise<CandlesResult> {
  const ms = INTERVAL_MS[interval]
  if (!ms) throw new Error(`unknown interval '${interval}'`)
  const windowBars = Math.ceil((toMs - fromMs) / ms)
  if (windowBars > MAX_BARS) {
    throw new Error(
      `window holds ${windowBars.toLocaleString()} ${interval} bars, over the ${MAX_BARS.toLocaleString()} cap — pick a coarser interval or a narrower range`
    )
  }

  const storeStart = await storeCandleStart(coin)
  const intervals = intervalOptions(fromMs, storeStart)
  const chosen = intervals.find(i => i.interval === interval)
  if (!chosen?.available || !chosen.source) {
    throw new Error(chosen?.reason ?? `${interval} cannot honestly serve this window`)
  }
  let source = chosen.source
  if (opts.forceSource === 'store') {
    if (interval === '1m' && storeStart !== null && fromMs >= storeStart) source = 'store'
    else throw new Error(`the captured 1m tape cannot honestly serve this window`)
  } else if (opts.forceSource === 'exchange') {
    if (fromMs >= retentionStart(interval)) source = 'exchange'
    else throw new Error(`${interval} exchange bars cannot honestly serve this window`)
  }

  const candles =
    source === 'exchange'
      ? await exchangeCandles(coin, interval, fromMs, toMs)
      : await storeCandles(coin, fromMs, toMs)

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
    coin,
    interval,
    interval_ms: ms,
    source,
    from: fromMs,
    to: toMs,
    candles,
    coverage: {
      bars: candles.length,
      window_bars: windowBars,
      missing_leading_ms: first === null ? toMs - fromMs : Math.max(first - fromMs, 0),
      missing_trailing_ms: last === null ? 0 : Math.max(toMs - last, 0),
      internal_gaps: internalGaps,
      largest_internal_gap_ms: largestGap,
      note:
        source === 'exchange'
          ? `exchange ${interval} bars, served as returned — absent bars stay absent`
          : `AlphaLens captured 1m tape — missing minutes are shown as gaps, never filled`,
    },
    intervals,
  }
}
