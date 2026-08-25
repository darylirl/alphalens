/**
 * Replay core — ported from backtest_copy.py, with its invariants kept as
 * assertions rather than comments. The strategy being replayed is different
 * (a pre-registered spec instead of a wallet to mirror), but the honesty
 * machinery is identical and is what actually matters:
 *
 *   1. NEVER FABRICATE ENTRIES FOR TRUNCATED HISTORY. A bar is only evaluable
 *      once every input it needs is fully covered by captured data: indicator
 *      warm-up bars, and a complete cohort lookback window whose wallet+coin
 *      pairs passed start_position validation (capture_gaps pairs are excluded
 *      upstream, in SQL). Signals before that instant are not emitted, and the
 *      served window is reported instead of the requested one.
 *   2. PER-TRADE FILL GRANULARITY DISCLOSURE. Candle retention forces coarser
 *      bars on older history; each trade records the granularity and the data
 *      source that priced it.
 *   3. PENNY-EXACT RECONCILIATION. net == gross - fees on every trade and in
 *      aggregate, checked to under half a cent; a mismatch aborts the job
 *      rather than shipping a number that does not add up.
 *   4. EXPLICIT FRICTIONS ON EVERY RESULT. Delay, slippage and taker fee are
 *      applied to both sides of every trade and stamped on every trade row.
 */

import { ruleWarmup } from './spec.mjs'
import { ema, rsi, priceChangePct } from './indicators.mjs'
import { INTERVAL_MS, ENTRY_SEARCH_MS, EXIT_SEARCH_MS } from './market.mjs'

export const ENGINE_VERSION = 'verify-engine@1.0.0'

/** Half a cent: the reconciliation tolerance. Anything above this is a bug. */
export const PENNY = 0.005

export class ReconciliationError extends Error {}

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

// ── three-valued rule evaluation ────────────────────────────────────────────
// null means "not evaluable from captured data". It propagates: a rule that
// cannot be evaluated does not fire, and cannot be silently read as false.

function kleeneAll(values) {
  if (values.some((v) => v === false)) return false
  if (values.some((v) => v === null)) return null
  return true
}

function kleeneAny(values) {
  if (values.some((v) => v === true)) return true
  if (values.some((v) => v === null)) return null
  return false
}

function compare(op, value, prevValue, threshold) {
  if (value === null || value === undefined) return null
  switch (op) {
    case 'lt': return value < threshold
    case 'lte': return value <= threshold
    case 'gt': return value > threshold
    case 'gte': return value >= threshold
    case 'cross_above':
      if (prevValue === null || prevValue === undefined) return null
      return prevValue <= threshold && value > threshold
    case 'cross_below':
      if (prevValue === null || prevValue === undefined) return null
      return prevValue >= threshold && value < threshold
    default: throw new Error(`unsupported op "${op}"`)
  }
}

/** Stable key for an indicator node, so identical indicators are computed once. */
function indicatorKey(node) {
  return node.indicator === 'price_change_pct'
    ? `price_change_pct:${node.lookback_bars}`
    : `${node.indicator}:${node.period}`
}

function collectIndicators(rule, into = new Map()) {
  if (!rule) return into
  if (rule.all) { rule.all.forEach((r) => collectIndicators(r, into)); return into }
  if (rule.any) { rule.any.forEach((r) => collectIndicators(r, into)); return into }
  if (rule.not) return collectIndicators(rule.not, into)
  if (rule.type === 'indicator') into.set(indicatorKey(rule), rule)
  return into
}

function collectCohortWindows(rule, into = new Set()) {
  if (!rule) return into
  if (rule.all) { rule.all.forEach((r) => collectCohortWindows(r, into)); return into }
  if (rule.any) { rule.any.forEach((r) => collectCohortWindows(r, into)); return into }
  if (rule.not) return collectCohortWindows(rule.not, into)
  if (rule.type === 'cohort') into.add(rule.window_h)
  return into
}

/**
 * Evaluate a rule on bar `i`.
 * @returns {boolean|null} null when an input is not covered by captured data.
 */
export function evalRule(rule, ctx, i) {
  if (rule.all) return kleeneAll(rule.all.map((r) => evalRule(r, ctx, i)))
  if (rule.any) return kleeneAny(rule.any.map((r) => evalRule(r, ctx, i)))
  if (rule.not) {
    const v = evalRule(rule.not, ctx, i)
    return v === null ? null : !v
  }

  if (rule.type === 'indicator') {
    const series = ctx.indicators.get(indicatorKey(rule))
    if (!series) return null
    const v = series[i]
    const prev = i > 0 ? series[i - 1] : null
    if (rule.indicator === 'ema') {
      const close = ctx.closes[i]
      const prevClose = i > 0 ? ctx.closes[i - 1] : null
      if (v === null || v === undefined) return null
      switch (rule.op) {
        case 'price_above': return close > v
        case 'price_below': return close < v
        case 'cross_above':
          if (prev === null || prev === undefined || prevClose === null) return null
          return prevClose <= prev && close > v
        case 'cross_below':
          if (prev === null || prev === undefined || prevClose === null) return null
          return prevClose >= prev && close < v
        default: throw new Error(`unsupported ema op "${rule.op}"`)
      }
    }
    return compare(rule.op, v ?? null, prev ?? null, rule.value)
  }

  if (rule.type === 'cohort') {
    if (!ctx.cohort) return null
    const ts = ctx.closeTs[i]
    const prevTs = i > 0 ? ctx.closeTs[i - 1] : null
    const v = ctx.cohort.metric(rule.metric, ts, rule.window_h, rule.side)
    const prev = prevTs === null ? null : ctx.cohort.metric(rule.metric, prevTs, rule.window_h, rule.side)
    return compare(rule.op, v, prev, rule.value)
  }

  // time rules — always evaluable, they read the clock, not the data
  const d = new Date(ctx.closeTs[i])
  if (rule.rule === 'day_of_week') return rule.days.includes(DAY_NAMES[d.getUTCDay()])
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes()
  const [sh, sm] = rule.start_utc.split(':').map(Number)
  const [eh, em] = rule.end_utc.split(':').map(Number)
  const start = sh * 60 + sm
  const end = eh * 60 + em
  return start <= end
    ? (minutes >= start && minutes < end)
    : (minutes >= start || minutes < end)   // session wrapping midnight UTC
}

// ── replay ──────────────────────────────────────────────────────────────────

/**
 * Replay one coin. Returns trades plus the coverage facts the result must
 * disclose. `cohort` may be null when the spec uses no cohort rules.
 */
export async function replayCoin({ spec, coin, market, cohort, log = [] }) {
  const ims = INTERVAL_MS[spec.bar_interval]
  const windowStart = Date.parse(spec.window.start)
  const windowEnd = Date.parse(spec.window.end)

  const entryWarm = ruleWarmup(spec.entry.rule)
  const exitWarm = spec.exit.condition ? ruleWarmup(spec.exit.condition) : { bars: 1, cohortHours: 0, usesCohort: false }
  const warmupBars = Math.max(entryWarm.bars, exitWarm.bars)
  const cohortHours = Math.max(entryWarm.cohortHours, exitWarm.cohortHours)

  const bars = await market.loadBars(coin, spec.bar_interval, windowStart - warmupBars * ims, windowEnd)
  if (bars.length === 0) {
    log.push(`${coin}: no bars available for ${spec.bar_interval} over the requested window; coin skipped`)
    return { trades: [], coverage: { coin, bars: 0, served_from: null, served_to: null, skipped: 'no_bars' } }
  }

  const closes = bars.map((b) => b.c)
  const closeTs = bars.map((b) => b.close_ts)

  const indicators = new Map()
  const nodes = collectIndicators(spec.entry.rule, collectIndicators(spec.exit.condition))
  for (const [key, node] of nodes) {
    if (node.indicator === 'ema') indicators.set(key, ema(closes, node.period))
    else if (node.indicator === 'rsi') indicators.set(key, rsi(closes, node.period))
    else indicators.set(key, priceChangePct(closes, node.lookback_bars))
  }

  const ctx = { closes, closeTs, indicators, cohort }

  // ── The anti-fabrication gate ─────────────────────────────────────────────
  // The first instant at which every input this spec reads is fully covered by
  // captured data. Nothing before it may produce a signal.
  const reasons = []
  let firstEvaluable = windowStart
  reasons.push(['window.start', windowStart])

  const warmBarIdx = Math.max(0, warmupBars - 1)
  if (bars[warmBarIdx]) {
    if (bars[warmBarIdx].close_ts > firstEvaluable) firstEvaluable = bars[warmBarIdx].close_ts
    reasons.push([`indicator warm-up (${warmupBars} bars)`, bars[warmBarIdx].close_ts])
  } else {
    firstEvaluable = Infinity
    reasons.push([`indicator warm-up (${warmupBars} bars)`, null])
  }

  const cohortWindows = collectCohortWindows(spec.entry.rule, collectCohortWindows(spec.exit.condition))
  let cohortHoles = []
  let coveredRun = null
  if (cohortWindows.size > 0) {
    const maxWindowH = Math.max(...cohortWindows)
    const cohortFirst = cohort ? cohort.firstEvaluableMs(maxWindowH) : null
    if (cohortFirst === null) {
      firstEvaluable = Infinity
      reasons.push([`cohort ${maxWindowH}h lookback`, null])
    } else {
      if (cohortFirst > firstEvaluable) firstEvaluable = cohortFirst
      reasons.push([`cohort ${maxWindowH}h lookback`, cohortFirst])
    }

    // Missing data is never zero (CLAUDE.md): where the aggregate has holes,
    // the replay runs inside the LONGEST contiguous covered run rather than
    // straddling a gap, and says out loud what it dropped. The null-guard in
    // CohortSeries.at() is the second line of defence — a rule that reaches
    // into a hole cannot evaluate at all.
    cohortHoles = cohort?.holes ?? []
    if (cohort && cohortHoles.length > 0) {
      coveredRun = cohort.longestCoveredRun()
      if (!coveredRun) {
        firstEvaluable = Infinity
        reasons.push(['longest contiguous cohort coverage', null])
      } else {
        const runFirstEvaluable = coveredRun[0] + maxWindowH * 3_600_000
        if (runFirstEvaluable > firstEvaluable) firstEvaluable = runFirstEvaluable
        reasons.push(['longest contiguous cohort coverage', runFirstEvaluable])
        log.push(`${coin}: cohort aggregate has ${cohortHoles.length} hole(s) totalling `
          + `${cohortHoles.reduce((s, h) => s + h.hours, 0)}h; replay narrowed to the longest contiguous run `
          + `${new Date(coveredRun[0]).toISOString()} .. ${new Date(coveredRun[1]).toISOString()} `
          + '— uncovered hours are NOT read as zero flow')
      }
    }
  }

  const lastEvaluable = Math.min(
    windowEnd,
    cohortWindows.size > 0 && cohort?.lastDataMs ? cohort.lastDataMs : windowEnd,
    coveredRun ? coveredRun[1] : windowEnd,
    bars[bars.length - 1].close_ts,
  )

  if (!Number.isFinite(firstEvaluable) || firstEvaluable >= lastEvaluable) {
    log.push(`${coin}: no evaluable bars — inputs are not covered by captured data over this window `
      + `(${reasons.map(([k, v]) => `${k}: ${v === null ? 'no data' : new Date(v).toISOString()}`).join('; ')})`)
    return {
      trades: [],
      coverage: {
        coin, bars: bars.length, served_from: null, served_to: null, skipped: 'no_covered_bars',
        coverage_reasons: Object.fromEntries(reasons.map(([k, v]) => [k, v === null ? null : new Date(v).toISOString()])),
      },
    }
  }

  const { delay_s: delayS, slippage_bps: slipBps, taker_fee_pct: takerPct } = spec.frictions
  const delayMs = delayS * 1000
  const takerFee = takerPct / 100
  const maxHoldMs = spec.exit.max_holding_time_h * 3_600_000
  const notional = spec.sizing.notional_usd
  const side = spec.entry.side
  const isLong = side === 'long'

  // Every decision this replay can take lands on a bar close plus the delay,
  // so the tape lookups are prefetched in batches instead of one round trip
  // per fill. (Test stubs omit prefetchTape; the ladder works either way.)
  if (typeof market.prefetchTape === 'function') {
    const targets = closeTs
      .filter((ts) => ts >= firstEvaluable && ts <= lastEvaluable)
      .map((ts) => ts + delayMs)
    targets.push(lastEvaluable + delayMs)
    await market.prefetchTape(coin, targets, ENTRY_SEARCH_MS)
  }

  const trades = []
  let position = null

  const openAt = async (signalTs) => {
    const decision = signalTs + delayMs
    const hit = await market.fillPrice(coin, decision, isLong, ENTRY_SEARCH_MS, slipBps)
    if (!hit) {
      log.push(`${coin}: no fill within ${ENTRY_SEARCH_MS / 60000}m of `
        + `${new Date(decision).toISOString()}; entry skipped (not fabricated)`)
      return
    }
    if (hit.ts < decision) throw new Error(`fill at ${hit.ts} precedes the delayed decision at ${decision}`)
    const qty = notional / hit.price
    position = {
      qty,
      entry_signal_ts: signalTs,
      entry_ts: hit.ts,
      entry_px: hit.price,
      entry_raw_px: hit.raw_price,
      entry_source: hit.source,
      entry_granularity: hit.granularity,
      entry_fee: qty * hit.price * takerFee,
    }
  }

  const closeAt = async (signalTs, reason) => {
    if (!position) return
    // A position cannot be exited before it was filled.
    const decision = Math.max(signalTs + delayMs, position.entry_ts + 1)
    const hit = await market.fillPrice(coin, decision, !isLong, EXIT_SEARCH_MS, slipBps)
    if (!hit) {
      log.push(`${coin}: no exit fill within ${EXIT_SEARCH_MS / 86_400_000}d of `
        + `${new Date(decision).toISOString()}; position abandoned unpriced (no trade recorded)`)
      position = null
      return
    }
    const qty = position.qty
    const sign = isLong ? 1 : -1
    const gross = qty * (hit.price - position.entry_px) * sign
    const exitFee = qty * hit.price * takerFee
    const fees = position.entry_fee + exitFee
    const net = gross - fees

    if (Math.abs(net - (gross - fees)) > PENNY) {
      throw new ReconciliationError(`trade reconciliation failed on ${coin}: net ${net} != gross ${gross} - fees ${fees}`)
    }

    trades.push({
      coin,
      side,
      qty,
      notional_usd: notional,
      entry_signal_ts: new Date(position.entry_signal_ts).toISOString(),
      entry_ts: new Date(position.entry_ts).toISOString(),
      entry_px: position.entry_px,
      entry_raw_px: position.entry_raw_px,
      entry_source: position.entry_source,
      entry_granularity: position.entry_granularity,
      exit_signal_ts: new Date(signalTs).toISOString(),
      exit_ts: new Date(hit.ts).toISOString(),
      exit_px: hit.price,
      exit_raw_px: hit.raw_price,
      exit_source: hit.source,
      exit_granularity: hit.granularity,
      gross_pnl_usd: gross,
      fees_usd: fees,
      net_pnl_usd: net,
      hold_s: (hit.ts - position.entry_ts) / 1000,
      exit_reason: reason,
      delay_s: delayS,
      slippage_bps: slipBps,
      taker_fee_pct: takerPct,
    })
    position = null
  }

  for (let i = 0; i < bars.length; i++) {
    const ts = closeTs[i]
    if (ts < firstEvaluable) continue
    if (ts > lastEvaluable) break

    if (position) {
      const heldOut = ts - position.entry_ts >= maxHoldMs
      const cond = spec.exit.condition ? evalRule(spec.exit.condition, ctx, i) === true : false
      if (heldOut) await closeAt(ts, 'max_holding_time')
      else if (cond) await closeAt(ts, 'exit_condition')
      continue                                  // one action per bar
    }

    if (evalRule(spec.entry.rule, ctx, i) === true) await openAt(ts)
  }

  if (position) {
    // Force-close at the end of the served window, flagged so it is never read
    // as a strategy exit.
    await closeAt(lastEvaluable, 'end_of_window')
  }

  return {
    trades,
    coverage: {
      coin,
      bars: bars.length,
      bar_interval: spec.bar_interval,
      served_from: new Date(firstEvaluable).toISOString(),
      served_to: new Date(lastEvaluable).toISOString(),
      cohort_rows: cohort ? cohort.rowCount : null,
      cohort_source: cohort ? cohort.source : null,
      cohort_coverage: cohort
        ? {
          hours_spanned: cohort.n,
          hours_covered: cohort.coveredHourCount,
          coverage_basis: cohort.coverageSource,
          holes: cohortHoles,
          narrowed_to_longest_run: coveredRun
            ? { from: new Date(coveredRun[0]).toISOString(), to: new Date(coveredRun[1]).toISOString() }
            : null,
        }
        : null,
      coverage_reasons: Object.fromEntries(
        reasons.map(([k, v]) => [k, v === null ? null : new Date(v).toISOString()]),
      ),
    },
  }
}

/**
 * Invariant check run over the finished trade list. Kept separate from trade
 * construction so the tests can assert it catches a violation.
 */
export function assertInvariants(trades, { frictions, servedFrom, servedTo }) {
  const delayMs = frictions.delay_s * 1000
  for (const t of trades) {
    const entrySignal = Date.parse(t.entry_signal_ts)
    const entry = Date.parse(t.entry_ts)
    const exit = Date.parse(t.exit_ts)

    if (entry < entrySignal + delayMs) {
      throw new ReconciliationError(
        `${t.coin}: entry filled at ${t.entry_ts}, before the ${frictions.delay_s}s delay from ${t.entry_signal_ts}`)
    }
    if (exit <= entry) {
      throw new ReconciliationError(`${t.coin}: exit ${t.exit_ts} does not follow entry ${t.entry_ts}`)
    }
    if (servedFrom && entrySignal < Date.parse(servedFrom)) {
      throw new ReconciliationError(
        `${t.coin}: entry signalled at ${t.entry_signal_ts}, before the served window opens at ${servedFrom} `
        + '— that entry would be fabricated from history the capture does not cover')
    }
    if (servedTo && entrySignal > Date.parse(servedTo)) {
      throw new ReconciliationError(
        `${t.coin}: entry signalled at ${t.entry_signal_ts}, after the served window closes at ${servedTo}`)
    }
    if (Math.abs(t.net_pnl_usd - (t.gross_pnl_usd - t.fees_usd)) > PENNY) {
      throw new ReconciliationError(
        `${t.coin}: net ${t.net_pnl_usd} != gross ${t.gross_pnl_usd} - fees ${t.fees_usd}`)
    }
    if (!t.entry_granularity || !t.exit_granularity || !t.entry_source || !t.exit_source) {
      throw new ReconciliationError(`${t.coin}: trade is missing fill source/granularity disclosure`)
    }
    if (t.delay_s !== frictions.delay_s || t.slippage_bps !== frictions.slippage_bps
        || t.taker_fee_pct !== frictions.taker_fee_pct) {
      throw new ReconciliationError(`${t.coin}: trade frictions do not match the spec frictions`)
    }
  }
  return true
}
