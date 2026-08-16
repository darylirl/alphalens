/**
 * Cohort positioning series — the pulse_24h data shapes, evaluated historically.
 *
 * pulse_24h only holds the trailing 24-48 hours, so the replay reads the same
 * aggregation over the window through verify_cohort_flow_hourly (migration
 * 010), which copies pulse_24h's direction semantics verbatim and excludes
 * capture_gaps wallet+coin pairs — a pair whose pre-capture history is
 * truncated has an untrustworthy start_position, and start_position is what
 * separates "opened a new position" from "added to one".
 *
 * Look-ahead containment: a rule evaluated at time T may only see hour buckets
 * that CLOSED before T. The bucket containing T is excluded even when T sits
 * exactly on the hour, so no signal can read its own future.
 */

import { rpcPageAll, pageAll } from './db.mjs'

/**
 * Wallet-filtered cohorts cannot use the precomputed table, so they aggregate
 * live through verify_cohort_flow_hourly — which must fit inside PostgREST's
 * 8s statement timeout. One day of one busy coin measured ~11s cold, so the
 * live path walks the window in small time chunks rather than one call.
 */
const LIVE_CHUNK_MS = 6 * 3_600_000

const HOUR_MS = 3_600_000

export class CohortSeries {
  /** @param {Array<object>} rows rows from verify_cohort_flow_hourly, ascending */
  constructor(rows, { coin, wallets, source = 'cohort_flow_hourly' }) {
    this.coin = coin
    this.wallets = wallets
    this.source = source
    this.rowCount = rows.length

    if (rows.length === 0) {
      this.firstHourIdx = null
      this.lastHourIdx = null
      this.n = 0
      return
    }

    const idx = (iso) => Math.floor(new Date(iso).getTime() / HOUR_MS)
    this.firstHourIdx = idx(rows[0].bucket)
    this.lastHourIdx = idx(rows[rows.length - 1].bucket)
    this.n = this.lastHourIdx - this.firstHourIdx + 1

    // Dense hourly arrays: an hour with no captured fills is a real zero for
    // flow purposes, and the covered span is reported in data_coverage so a
    // capture outage inside the window is visible rather than silently 0.
    const dense = (key) => {
      const a = new Float64Array(this.n)
      for (const r of rows) a[idx(r.bucket) - this.firstHourIdx] = Number(r[key]) || 0
      return a
    }
    const notional = dense('notional')
    const netFlow = dense('net_flow')
    const newLongs = dense('new_longs')
    const newShorts = dense('new_shorts')
    const fills = dense('fills')

    // Prefix sums so a rolling window read is O(1) per bar.
    this.pre = {}
    for (const [name, arr] of Object.entries({ notional, netFlow, newLongs, newShorts, fills })) {
      const p = new Float64Array(this.n + 1)
      for (let i = 0; i < this.n; i++) p[i + 1] = p[i] + arr[i]
      this.pre[name] = p
    }
  }

  get firstDataMs() { return this.firstHourIdx === null ? null : this.firstHourIdx * HOUR_MS }
  get lastDataMs() { return this.lastHourIdx === null ? null : (this.lastHourIdx + 1) * HOUR_MS }

  /**
   * Earliest instant at which a `windowH`-hour rolling read is fully covered by
   * captured data. Evaluating before this would average over hours we never
   * captured — that is fabrication, so the engine refuses to emit signals then.
   */
  firstEvaluableMs(windowH) {
    if (this.firstHourIdx === null) return null
    return (this.firstHourIdx + windowH) * HOUR_MS
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
   * before `tsMs`. Returns null when the window is not fully covered by data.
   */
  at(tsMs, windowH) {
    if (this.firstHourIdx === null) return null
    const lastIdx = Math.floor(tsMs / HOUR_MS) - 1     // last fully-closed hour
    const fromIdx = lastIdx - windowH + 1
    if (fromIdx < this.firstHourIdx || lastIdx > this.lastHourIdx) return null

    const notional = this._sum('notional', fromIdx, lastIdx)
    const netFlow = this._sum('netFlow', fromIdx, lastIdx)
    const newLongs = this._sum('newLongs', fromIdx, lastIdx)
    const newShorts = this._sum('newShorts', fromIdx, lastIdx)
    return {
      notional_usd: notional,
      net_flow_usd: netFlow,
      net_flow_skew: notional > 0 ? netFlow / notional : 0,
      new_longs: newLongs,
      new_shorts: newShorts,
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
 * Load the hourly cohort series for one coin over [fromMs, toMs).
 *
 * Fast path (no wallet filter): the precomputed cohort_flow_hourly table,
 * read with explicit ordering and paging.
 * Slow path (wallet-filtered cohort): live aggregation, chunked by time so no
 * single statement can blow the API timeout.
 */
export async function loadCohortSeries(coin, fromMs, toMs, wallets = null) {
  if (!wallets) {
    const rows = await pageAll(
      `cohort_flow_hourly?select=bucket,fills,wallets,notional,net_flow,new_longs,new_shorts`
      + `&coin=eq.${encodeURIComponent(coin)}`
      + `&bucket=gte.${new Date(fromMs).toISOString()}`
      + `&bucket=lt.${new Date(toMs).toISOString()}`
      + `&order=bucket.asc`,
    )
    return new CohortSeries(rows, { coin, wallets: null, source: 'cohort_flow_hourly' })
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
  return new CohortSeries(rows, { coin, wallets, source: 'verify_cohort_flow_hourly' })
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
  if (addresses.length > cap) return addresses.slice(0, cap)
  return addresses
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
  const rows = await pageAll(`recent_fill_coins?select=coin,fills&order=fills.desc`, { pageSize: Math.min(n, 1000), maxRows: n })
  return rows.slice(0, n).map((r) => r.coin)
}

export const TOP_COINS_LOOKAHEAD_FLAG =
  'universe.cohort_filters.top_n_coins_by_notional selected coins from recent_fill_coins (trailing 7 days), '
  + 'which postdates the replay window: coin selection carries look-ahead bias.'
