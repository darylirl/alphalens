/**
 * Market data for the replay: the evaluation bar grid and the fill-price
 * ladder.
 *
 * Two invariants ported from backtest_copy.py live here:
 *
 *  1. THE CANDLE INTERVAL LADDER. Hyperliquid retains only ~5000 bars per
 *     interval (measured live: 1m→3.5d, 5m→17.4d, 15m→52.1d, 1h→208.4d,
 *     4h→833d). "Fill at the next 1m open" is physically impossible for
 *     history older than ~3.5 days, so a fill uses the FINEST interval whose
 *     retention still covers its timestamp and every trade records the
 *     granularity it was filled at. A result that does not disclose its
 *     granularity mix is not honest about what it measured.
 *
 *  2. SOURCE DISCLOSURE. Fill prices come from the captured `fills` tape
 *     first — those are real prints, continuously captured — then the captured
 *     `candles_1m` table, then the candleSnapshot API as the gap fallback.
 *     Every trade records which source served it.
 */

import { sb, pageAll, rpc } from './db.mjs'

const HL_REST = process.env.HL_REST_URL || 'https://api.hyperliquid.xyz/info'
const REST_MIN_INTERVAL_MS = 800
const RETENTION_BARS = 4900          // conservative vs the ~5000 measured
const CHUNK_BARS = 4000              // bars per candleSnapshot request (< 5000 cap)

export const CANDLE_INTERVALS = Object.freeze([   // finest → coarsest
  ['1m', 60_000],
  ['5m', 300_000],
  ['15m', 900_000],
  ['1h', 3_600_000],
  ['4h', 14_400_000],
  ['1d', 86_400_000],
])

export const INTERVAL_MS = Object.fromEntries(CANDLE_INTERVALS)

/** Search windows, ported: entries are abandoned quickly, exits walk forward. */
export const ENTRY_SEARCH_MS = 15 * 60_000
export const EXIT_SEARCH_MS = 7 * 24 * 60 * 60_000

let lastRest = 0
async function hl(body, retries = 4) {
  const wait = REST_MIN_INTERVAL_MS - (Date.now() - lastRest)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastRest = Date.now()
  let delay = 2000
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(HL_REST, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) return await res.json()
      if (attempt >= retries) return null
    } catch {
      if (attempt >= retries) return null
    }
    await new Promise((r) => setTimeout(r, delay))
    delay *= 2
  }
}

/** Finest interval whose retention window still covers `ts`. */
export function intervalFor(ts, now = Date.now()) {
  for (const [name, ms] of CANDLE_INTERVALS) {
    if (ts >= now - RETENTION_BARS * ms) return [name, ms]
  }
  return CANDLE_INTERVALS[CANDLE_INTERVALS.length - 1]
}

/** Earliest timestamp the API can still serve at `interval`. */
export function retentionStart(interval, now = Date.now()) {
  return now - RETENTION_BARS * INTERVAL_MS[interval]
}

export class Market {
  /**
   * @param {object} opts
   * @param {number} opts.now  frozen "now" for the whole job, so the retention
   *   ladder cannot shift mid-replay and produce two granularities for the
   *   same timestamp.
   */
  constructor({ now = Date.now(), fetchCandles = hl } = {}) {
    this.now = now
    this.fetchCandles = fetchCandles
    this.chunks = new Map()      // `${coin}|${interval}|${chunkStart}` -> true
    this.opens = new Map()       // `${coin}|${interval}` -> Map(barTs -> {o,h,l,c,v})
    this.dead = new Set()
    this.sourceCounts = { fills: 0, candles_1m: 0, candleSnapshot: 0 }
    this.granularityCounts = {}
    this.tapeCache = new Map()   // `${coin}|${targetMs}` -> {hit, searchMs}
  }

  /**
   * Prefetch tape prints for a known set of decision timestamps.
   *
   * Every decision a replay can take happens at a bar close plus the friction
   * delay, so the whole set is knowable before the replay runs. Asking for
   * them in batches turns N PostgREST round trips into N/CHUNK statements —
   * the difference between a replay that finishes and one that spends its life
   * in per-request latency on a busy database.
   */
  async prefetchTape(coin, targetsMs, searchMs, chunkSize = 250) {
    const targets = [...new Set(targetsMs)].sort((a, b) => a - b)
    for (let i = 0; i < targets.length; i += chunkSize) {
      const chunk = targets.slice(i, i + chunkSize)
      const rows = await rpc('verify_tape_prices_at', {
        p_coin: coin,
        p_targets: chunk.map((t) => new Date(t).toISOString()),
        p_search: `${Math.round(searchMs / 1000)} seconds`,
      })
      const byTarget = new Map(
        (rows || []).map((r) => [new Date(r.target).getTime(), r]),
      )
      for (const t of chunk) {
        const r = byTarget.get(t)
        const hit = r && r.ts
          ? { ts: new Date(r.ts).getTime(), price: r.price, source: 'fills', granularity: 'tape' }
          : null
        this.tapeCache.set(`${coin}|${t}`, { hit, searchMs })
      }
    }
  }

  _bars(coin, interval) {
    const key = `${coin}|${interval}`
    let m = this.opens.get(key)
    if (!m) { m = new Map(); this.opens.set(key, m) }
    return m
  }

  async _ensureChunk(coin, interval, chunkStart) {
    const ims = INTERVAL_MS[interval]
    const key = `${coin}|${interval}|${chunkStart}`
    if (this.chunks.has(key) || this.dead.has(key)) return
    const end = chunkStart + CHUNK_BARS * ims
    const data = await this.fetchCandles({
      type: 'candleSnapshot',
      req: { coin, interval, startTime: chunkStart, endTime: end },
    })
    if (!Array.isArray(data) || data.length === 0) { this.dead.add(key); return }
    const bars = this._bars(coin, interval)
    for (const c of data) {
      bars.set(Number(c.t), {
        t: Number(c.t),
        o: parseFloat(c.o),
        h: parseFloat(c.h),
        l: parseFloat(c.l),
        c: parseFloat(c.c),
        v: parseFloat(c.v || '0'),
      })
    }
    this.chunks.set(key, true)
  }

  /**
   * The evaluation grid. Bars are returned in ascending open time, each with
   * `close_ts` = open + interval: a rule may only be evaluated on a bar that
   * has CLOSED, otherwise the signal peeks at its own future.
   *
   * For 1m the captured candles_1m table is consulted first (it outlives the
   * API's 3.5-day retention going forward); the API fills whatever it lacks.
   */
  async loadBars(coin, interval, fromMs, toMs) {
    const ims = INTERVAL_MS[interval]
    if (!ims) throw new Error(`unsupported bar interval "${interval}"`)

    const bars = this._bars(coin, interval)
    let capturedFrom = null

    if (interval === '1m') {
      const rows = await pageAll(
        `candles_1m?select=t,o,h,l,c,v&coin=eq.${encodeURIComponent(coin)}`
        + `&t=gte.${new Date(fromMs).toISOString()}&t=lt.${new Date(toMs).toISOString()}&order=t.asc`,
      )
      for (const r of rows) {
        const t = new Date(r.t).getTime()
        bars.set(t, { t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v, captured: true })
      }
      if (rows.length) capturedFrom = new Date(rows[0].t).getTime()
    }

    const apiFrom = retentionStart(interval, this.now)
    const needFrom = capturedFrom !== null ? Math.min(fromMs, capturedFrom) : fromMs
    if (needFrom < apiFrom && !(interval === '1m' && capturedFrom !== null && capturedFrom <= fromMs)) {
      const finest = CANDLE_INTERVALS.find(([name]) => fromMs >= retentionStart(name, this.now))
      throw new Error(
        `bar_interval "${interval}" cannot serve a window starting ${new Date(fromMs).toISOString()}: `
        + `Hyperliquid retains ~${RETENTION_BARS} bars per interval, so ${interval} only reaches back to `
        + `${new Date(apiFrom).toISOString()}. Finest interval covering this window: `
        + `${finest ? finest[0] : '1d'}. Re-submit the spec with that bar_interval (or a later window.start) — `
        + 'the engine will not silently coarsen your strategy.',
      )
    }

    const chunkMs = CHUNK_BARS * ims
    for (let c = Math.floor(fromMs / chunkMs) * chunkMs; c < toMs; c += chunkMs) {
      await this._ensureChunk(coin, interval, c)
    }

    const out = []
    for (const bar of bars.values()) {
      if (bar.t >= fromMs && bar.t < toMs) out.push({ ...bar, close_ts: bar.t + ims })
    }
    out.sort((a, b) => a.t - b.t)
    return out
  }

  /** First captured tape print at or after `fromMs`, within `searchMs`. */
  async _tapePrice(coin, fromMs, searchMs) {
    const cached = this.tapeCache.get(`${coin}|${fromMs}`)
    if (cached) {
      // A cached hit is valid for any search window; a cached miss only proves
      // absence over the window it was prefetched with.
      if (cached.hit) return cached.hit
      if (searchMs <= cached.searchMs) return null
    }

    const rows = await sb(
      `fills?select=timestamp,price&asset=eq.${encodeURIComponent(coin)}`
      + `&timestamp=gte.${new Date(fromMs).toISOString()}`
      + `&timestamp=lt.${new Date(fromMs + searchMs).toISOString()}`
      + '&tid=not.is.null&order=timestamp.asc&limit=1',
    )
    if (!rows || rows.length === 0) return null
    return { ts: new Date(rows[0].timestamp).getTime(), price: rows[0].price, source: 'fills', granularity: 'tape' }
  }

  /** First captured 1m bar open at or after `fromMs`, within `searchMs`. */
  async _capturedCandlePrice(coin, fromMs, searchMs) {
    const rows = await sb(
      `candles_1m?select=t,o&coin=eq.${encodeURIComponent(coin)}`
      + `&t=gte.${new Date(fromMs).toISOString()}`
      + `&t=lt.${new Date(fromMs + searchMs).toISOString()}`
      + '&order=t.asc&limit=1',
    )
    if (!rows || rows.length === 0) return null
    return { ts: new Date(rows[0].t).getTime(), price: rows[0].o, source: 'candles_1m', granularity: '1m' }
  }

  /** Open of the first retained API bar at or after `fromMs`, within `searchMs`. */
  async _snapshotPrice(coin, fromMs, searchMs) {
    const [iname, ims] = intervalFor(fromMs, this.now)
    const chunkMs = CHUNK_BARS * ims
    const end = fromMs + Math.max(searchMs, 3 * ims)
    let t = Math.ceil(fromMs / ims) * ims
    const bars = this._bars(coin, iname)
    while (t < end) {
      await this._ensureChunk(coin, iname, Math.floor(t / chunkMs) * chunkMs)
      const chunkEnd = Math.floor(t / chunkMs) * chunkMs + chunkMs
      while (t < Math.min(end, chunkEnd)) {
        const bar = bars.get(t)
        if (bar) return { ts: t, price: bar.o, source: 'candleSnapshot', granularity: iname }
        t += ims
      }
    }
    return null
  }

  /**
   * The fill price for a decision taken at `decisionMs` (already delayed).
   * Source ladder: captured tape → captured 1m candles → candleSnapshot API.
   * Adverse slippage is applied here so no caller can forget it.
   *
   * @returns {{ts:number, price:number, raw_price:number, source:string, granularity:string}|null}
   */
  async fillPrice(coin, decisionMs, isBuy, searchMs, slippageBps) {
    const hit = (await this._tapePrice(coin, decisionMs, searchMs))
      ?? (await this._capturedCandlePrice(coin, decisionMs, searchMs))
      ?? (await this._snapshotPrice(coin, decisionMs, searchMs))
    if (!hit) return null

    const slip = slippageBps / 10_000
    const price = isBuy ? hit.price * (1 + slip) : hit.price * (1 - slip)

    this.sourceCounts[hit.source] = (this.sourceCounts[hit.source] || 0) + 1
    this.granularityCounts[hit.granularity] = (this.granularityCounts[hit.granularity] || 0) + 1

    return { ts: hit.ts, price, raw_price: hit.price, source: hit.source, granularity: hit.granularity }
  }
}
