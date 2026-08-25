/**
 * Cohort positioning series — the pulse_24h data shapes, evaluated historically.
 *
 * pulse_24h only holds the trailing 24-48 hours, so the replay reads the same
 * aggregation over the window from cohort_flow_hourly (migration 011), which
 * copies pulse_24h's direction semantics verbatim and excludes capture_gaps
 * wallet+coin pairs — a pair whose pre-capture history is truncated has an
 * untrustworthy start_position, and start_position is what separates "opened a
 * new position" from "added to one".
 *
 * TWO RULES GOVERN THIS FILE.
 *
 * 1. MISSING DATA IS NEVER ZERO. An hour for which the aggregate was never
 *    built is a hole, not a quiet market. Reading a hole as zero flow would
 *    manufacture a signal out of an outage — the aggregate was partially built
 *    once during development, and a zero-filling series would have replayed
 *    those gaps as genuine "cohort went flat" readings. Coverage is therefore
 *    tracked explicitly: an hour counts as covered when the aggregate holds a
 *    row for ANY coin in that hour (the build is global, so a coin with no row
 *    inside a covered hour genuinely did not trade). Any rolling window that
 *    touches an uncovered hour returns null, and null cannot fire a rule.
 *
 * 2. LOOK-AHEAD CONTAINMENT. A rule evaluated at time T may only see hour
 *    buckets that CLOSED before T. The bucket containing T is excluded even
 *    when T sits exactly on the hour, so no signal can read its own future.
 */

import { rpcPageAll, pageAll } from './db.mjs'

/**
 * Wallet-filtered cohorts cannot use the precomputed table, so they aggregate
 * live through verify_cohort_flow_hourly — which must fit inside PostgREST's
 * statement timeout. The live path walks the window in small time chunks
 * rather than one call.
 */
const LIVE_CHUNK_MS = 6 * 3_600_000
const HOUR_MS = 3_600_000

const hourIdx = (ms) => Math.floor(ms / HOUR_MS)

export class CohortSeries {
  /**
   * @param {Array<object>} rows rows from the hourly aggregate, ascending
   * @param {object} opts
   * @param {Set<number>|null} opts.coveredHours hour indices the aggregate was
   *   built for. When null, coverage falls back to the hours this coin has
   *   rows for — the strict reading, which never invents zeros but will refuse
   *   on genuinely quiet hours.
   * @param {number} [opts.spanFromMs] requested span, so coverage can be
   *   judged over what was ASKED for, not only over what came back.
   */
  constructor(rows, { coin, wallets, source = 'cohort_flow_hourly', coveredHours = null, spanFromMs, spanToMs } = {}) {
    this.coin = coin
    this.wallets = wallets
    this.source = source
    this.rowCount = rows.length
    this.coverageSource = coveredHours ? 'aggregate build coverage' : 'rows present for this coin'

    const rowIdx = rows.map((r) => hourIdx(new Date(r.bucket).getTime()))
    const candidates = coveredHours && coveredHours.size ? [...coveredHours] : rowIdx
    if (candidates.length === 0) {
      this.firstHourIdx = null
      this.lastHourIdx = null
      this.n = 0
      this.holes = []
      return
    }

    // The array spans the requested window when given, so an aggregate that
    // simply stops short shows up as uncovered tail rather than as no window.
    const lo = spanFromMs !== undefined ? Math.min(hourIdx(spanFromMs), Math.min(...candidates)) : Math.min(...candidates)
    const hi = spanToMs !== undefined ? Math.max(hourIdx(spanToMs) - 1, Math.max(...candidates)) : Math.max(...candidates)

    this.firstHourIdx = lo
    this.lastHourIdx = hi
    this.n = hi - lo + 1

    const covered = new Uint8Array(this.n)
    for (const i of candidates) {
      if (i >= lo && i <= hi) covered[i - lo] = 1
    }

    const dense = (key) => {
      const a = new Float64Array(this.n)
      rows.forEach((r, k) => {
        const i = rowIdx[k] - lo
        if (i >= 0 && i < this.n) a[i] = Number(r[key]) || 0
      })
      return a
    }

    // Prefix sums so a rolling read is O(1) per bar — including the coverage
    // count, which is what makes "is this whole window real data?" cheap.
    this.pre = {}
    for (const [name, arr] of Object.entries({
      notional: dense('notional'),
      netFlow: dense('net_flow'),
      newLongs: dense('new_longs'),
      newShorts: dense('new_shorts'),
      fills: dense('fills'),
    })) {
      const p = new Float64Array(this.n + 1)
      for (let i = 0; i < this.n; i++) p[i + 1] = p[i] + arr[i]
      this.pre[name] = p
    }
    const cp = new Int32Array(this.n + 1)
    for (let i = 0; i < this.n; i++) cp[i + 1] = cp[i] + covered[i]
    this.pre.covered = cp
    this.coveredFlags = covered

    // Uncovered runs, reported on every result so a narrowed window is never
    // silent about what it dropped.
    this.holes = []
    let runStart = null
    for (let i = 0; i <= this.n; i++) {
      const isHole = i < this.n && covered[i] === 0
      if (isHole && runStart === null) runStart = i
      if (!isHole && runStart !== null) {
        this.holes.push({
          from: new Date((lo + runStart) * HOUR_MS).toISOString(),
          to: new Date((lo + i) * HOUR_MS).toISOString(),
          hours: i - runStart,
        })
        runStart = null
      }
    }
  }

  get firstDataMs() { return this.firstHourIdx === null ? null : this.firstHourIdx * HOUR_MS }
  get lastDataMs() { return this.lastHourIdx === null ? null : (this.lastHourIdx + 1) * HOUR_MS }
  get coveredHourCount() { return this.n === 0 ? 0 : this.pre.covered[this.n] }

  _coveredBetween(fromIdx, toIdx) {
    const lo = Math.max(0, fromIdx - this.firstHourIdx)
    const hi = Math.min(this.n, toIdx - this.firstHourIdx + 1)
    if (hi <= lo) return 0
    return this.pre.covered[hi] - this.pre.covered[lo]
  }

  /** Longest run of consecutive covered hours, as [startMs, endMs) or null. */
  longestCoveredRun() {
    if (this.n === 0) return null
    let best = null
    let start = null
    for (let i = 0; i <= this.n; i++) {
      const on = i < this.n && this.coveredFlags[i] === 1
      if (on && start === null) start = i
      if (!on && start !== null) {
        if (!best || i - start > best[1] - best[0]) best = [start, i]
        start = null
      }
    }
    if (!best) return null
    return [(this.firstHourIdx + best[0]) * HOUR_MS, (this.firstHourIdx + best[1]) * HOUR_MS]
  }

  /**
   * Earliest instant at which a `windowH`-hour rolling read is entirely
   * covered by built aggregate. Evaluating before this would average over
   * hours nobody ever computed.
   */
  firstEvaluableMs(windowH) {
    if (this.n === 0) return null
    for (let i = windowH - 1; i < this.n; i++) {
      const idx = this.firstHourIdx + i
      if (this._coveredBetween(idx - windowH + 1, idx) === windowH) return (idx + 1) * HOUR_MS
    }
    return null
  }

  _sum(name, fromIdx, toIdx) {
    const p = this.pre[name]
    const lo = Math.max(0, fromIdx - this.firstHourIdx)
    const hi = Math.min(this.n, toIdx - this.firstHourIdx + 1)
    if (hi <= lo) return 0
    return p[hi] - p[lo]
  }

  /**
   * Rolling aggregate over the `windowH` hour buckets that closed strictly
   * before `tsMs`. Returns null when any hour in that window is outside the
   * built aggregate — missing data is never zero.
   */
  at(tsMs, windowH) {
    if (this.n === 0) return null
    const lastIdx = Math.floor(tsMs / HOUR_MS) - 1     // last fully-closed hour
    const fromIdx = lastIdx - windowH + 1
    if (fromIdx < this.firstHourIdx || lastIdx > this.lastHourIdx) return null
    if (this._coveredBetween(fromIdx, lastIdx) !== windowH) return null

    const notional = this._sum('notional', fromIdx, lastIdx)
    const netFlow = this._sum('netFlow', fromIdx, lastIdx)
    return {
      notional_usd: notional,
      net_flow_usd: netFlow,
      net_flow_skew: notional > 0 ? netFlow / notional : 0,
      new_longs: this._sum('newLongs', fromIdx, lastIdx),
      new_shorts: this._sum('newShorts', fromIdx, lastIdx),
      fills: this._sum('fills', fromIdx, lastIdx),
    }
  }

  /** Value of one grammar metric at `tsMs`, or null when uncovered. */
  metric(name, tsMs, windowH, side = 'net') {
    const agg = this.at(tsMs, windowH)
    if (!agg) return null
    if (name === 'net_flow_usd') return agg.net_flow_usd
    if (name === 'net_flow_skew') return agg.net_flow_skew
    if (name === 'new_position_count') {
      if (side === 'long') return agg.new_longs
      if (side === 'short') return agg.new_shorts
      return agg.new_longs - agg.new_shorts
    }
    throw new Error(`unsupported cohort metric "${name}"`)
  }
}

/**
 * Hours the hourly aggregate was actually built for, across all coins.
 * This is the coverage ground truth: the build is global per hour, so an hour
 * present for any coin was computed for every coin, and a coin missing from a
 * covered hour genuinely did not trade in it.
 */
export async function loadCoverageHours(fromMs, toMs) {
  const rows = await rpcPageAll('cohort_flow_coverage_hours', {
    p_from: new Date(fromMs).toISOString(),
    p_to: new Date(toMs).toISOString(),
  })
  return new Set(rows.map((r) => hourIdx(new Date(r.bucket).getTime())))
}

/**
 * Load the hourly cohort series for one coin over [fromMs, toMs).
 *
 * Fast path (no wallet filter): the precomputed cohort_flow_hourly table.
 * Slow path (wallet-filtered cohort): live aggregation, chunked by time so no
 * single statement can blow the API timeout.
 */
export async function loadCohortSeries(coin, fromMs, toMs, wallets = null) {
  const coveredHours = await loadCoverageHours(fromMs, toMs)
  const common = { coin, wallets, coveredHours, spanFromMs: fromMs, spanToMs: toMs }

  if (!wallets) {
    const rows = await pageAll(
      `cohort_flow_hourly?select=bucket,fills,wallets,notional,net_flow,new_longs,new_shorts`
      + `&coin=eq.${encodeURIComponent(coin)}`
      + `&bucket=gte.${new Date(fromMs).toISOString()}`
      + `&bucket=lt.${new Date(toMs).toISOString()}`
      + `&order=bucket.asc`,
    )
    return new CohortSeries(rows, { ...common, source: 'cohort_flow_hourly' })
  }

  const rows = []
  for (let from = fromMs; from < toMs; from += LIVE_CHUNK_MS) {
    const to = Math.min(from + LIVE_CHUNK_MS, toMs)
    const chunk = await rpcPageAll('verify_cohort_flow_hourly', {
      p_coin: coin,
      p_from: new Date(from).toISOString(),
      p_to: new Date(to).toISOString(),
      p_wallets: wallets,
    })
    rows.push(...chunk)
  }
  return new CohortSeries(rows, { ...common, source: 'verify_cohort_flow_hourly' })
}

/**
 * Resolve cohort_filters to the wallet set whose flow forms the signal.
 * Returns null when no filters are given: the signal is then the whole
 * captured cohort, which is what the live /pulse page shows.
 */
export async function resolveCohortWallets(filters) {
  if (!filters) return null
  const parts = ['wallets?select=address']
  if (filters.archetypes?.length) {
    parts.push(`&archetype=in.(${filters.archetypes.map(encodeURIComponent).join(',')})`)
  }
  if (filters.min_sharpe_30d !== undefined) parts.push(`&sharpe_30d=gte.${filters.min_sharpe_30d}`)
  if (filters.max_trade_count_30d !== undefined) parts.push(`&trade_count_30d=lte.${filters.max_trade_count_30d}`)
  if (filters.min_win_rate !== undefined) parts.push(`&win_rate=gte.${filters.min_win_rate}`)
  parts.push('&order=address.asc')

  const rows = await pageAll(parts.join(''), { maxRows: 20_000 })
  const addresses = rows.map((r) => String(r.address).toLowerCase())
  const cap = filters.max_wallets ?? 2000
  return addresses.length > cap ? addresses.slice(0, cap) : addresses
}

/**
 * Resolve `top_n_coins_by_notional` from recent_fill_coins.
 *
 * HONESTY NOTE, surfaced as a look-ahead flag on every result that uses it:
 * recent_fill_coins covers the trailing 7 days, which POSTDATES any historical
 * replay window. Picking coins this way means the replay only trades coins the
 * cohort is active in TODAY — the same look-ahead bias backtest_copy.py flags
 * for its Sharpe-ranked cohort. Explicit universe.coins has no such bias.
 */
export async function resolveTopCoins(n) {
  const rows = await pageAll('recent_fill_coins?select=coin,fills&order=fills.desc', { pageSize: Math.min(n, 1000), maxRows: n })
  return rows.slice(0, n).map((r) => r.coin)
}

export const TOP_COINS_LOOKAHEAD_FLAG =
  'universe.cohort_filters.top_n_coins_by_notional selected coins from recent_fill_coins (trailing 7 days), '
  + 'which postdates the replay window: coin selection carries look-ahead bias.'
