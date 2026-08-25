/**
 * Metrics, verdict and the per-trade CSV.
 *
 * The metric definitions are ported from backtest_copy.py's summarize() so a
 * verification result is directly comparable with the original replay's
 * numbers. Drawdown percent is stated against an explicit capital base rather
 * than derived, exactly as the original does — one fixed-notional position at
 * a time means the base is the position notional, and the assumption is
 * carried in the metrics object instead of living in a footnote.
 */

import { PENNY, ReconciliationError } from './engine.mjs'

export function summarize(trades, { capitalBase }) {
  const closed = [...trades].sort((a, b) => Date.parse(a.exit_ts) - Date.parse(b.exit_ts))

  const gross = closed.reduce((s, t) => s + t.gross_pnl_usd, 0)
  const fees = closed.reduce((s, t) => s + t.fees_usd, 0)
  const net = closed.reduce((s, t) => s + t.net_pnl_usd, 0)

  // Aggregate reconciliation: the totals must add up too, not just each row.
  if (Math.abs(net - (gross - fees)) > PENNY) {
    throw new ReconciliationError(
      `aggregate reconciliation failed: net ${net} != gross ${gross} - fees ${fees}`)
  }

  const wins = closed.filter((t) => t.net_pnl_usd > 0)
  const losses = closed.filter((t) => t.net_pnl_usd <= 0)
  const grossWin = wins.reduce((s, t) => s + t.net_pnl_usd, 0)
  const grossLoss = -losses.reduce((s, t) => s + t.net_pnl_usd, 0)

  let equity = 0
  let peak = 0
  let maxDd = 0
  for (const t of closed) {
    equity += t.net_pnl_usd
    peak = Math.max(peak, equity)
    maxDd = Math.max(maxDd, peak - equity)
  }

  const monthlyMap = new Map()
  for (const t of closed) {
    const month = t.exit_ts.slice(0, 7)
    const m = monthlyMap.get(month) || { month, trades: 0, net_pnl_usd: 0 }
    m.trades += 1
    m.net_pnl_usd += t.net_pnl_usd
    monthlyMap.set(month, m)
  }
  const monthly = [...monthlyMap.values()].sort((a, b) => a.month.localeCompare(b.month))

  const profitFactorInfinite = grossLoss === 0 && grossWin > 0
  const profitFactor = closed.length === 0 ? null
    : (profitFactorInfinite ? null : (grossLoss > 0 ? grossWin / grossLoss : null))

  return {
    trade_count: closed.length,
    // Money is rounded to 6 decimals, not to cents: rounding to cents would
    // make net == gross - fees false at the reported precision, and that
    // identity is one of the invariants this service promises.
    net_pnl_usd: round6(net),
    gross_pnl_usd: round6(gross),
    fees_usd: round6(fees),
    reconciliation_residual_usd: round6(net - (gross - fees)),
    win_rate: closed.length ? wins.length / closed.length : null,
    profit_factor: profitFactor === null ? null : round4(profitFactor),
    profit_factor_infinite: profitFactorInfinite,
    max_drawdown_usd: round6(maxDd),
    max_drawdown_pct: capitalBase > 0 ? round4((maxDd / capitalBase) * 100) : null,
    capital_base_usd: capitalBase,
    capital_base_note:
      'Stated, not derived: one fixed-notional position at a time, so the base is the position notional. '
      + 'Drawdown percent means nothing without it.',
    avg_hold_s: closed.length ? closed.reduce((s, t) => s + t.hold_s, 0) / closed.length : null,
    winning_trades: wins.length,
    losing_trades: losses.length,
    forced_exits: closed.filter((t) => t.exit_reason === 'end_of_window').length,
    monthly,
    worst_month_pnl_usd: monthly.length ? round6(Math.min(...monthly.map((m) => m.net_pnl_usd))) : null,
    positive_month_ratio: monthly.length
      ? monthly.filter((m) => m.net_pnl_usd > 0).length / monthly.length
      : null,
  }
}

/** Numeric value a kill criterion reads. Infinity is a real value here. */
function metricValue(metrics, name) {
  if (name === 'profit_factor') {
    if (metrics.profit_factor_infinite) return Number.POSITIVE_INFINITY
    return metrics.profit_factor
  }
  const v = metrics[name]
  return v === undefined ? null : v
}

function triggers(op, observed, threshold) {
  switch (op) {
    case 'lt': return observed < threshold
    case 'lte': return observed <= threshold
    case 'gt': return observed > threshold
    case 'gte': return observed >= threshold
    default: throw new Error(`unsupported kill criterion op "${op}"`)
  }
}

/**
 * Evaluate every pre-registered kill criterion.
 *
 * A criterion is a condition that KILLS the strategy when it is true, so
 * pass = not triggered. A criterion whose metric could not be computed (no
 * trades, for instance) does NOT pass: an unevaluated falsifier has not been
 * survived, and reporting it as passed would be the exact fabrication this
 * service exists to prevent.
 */
export function evaluateVerdict(killCriteria, metrics) {
  const criteria = killCriteria.map((c) => {
    const observed = metricValue(metrics, c.metric)
    const evaluable = observed !== null && observed !== undefined && !Number.isNaN(observed)
    const triggered = evaluable ? triggers(c.op, observed, c.value) : null
    return {
      id: c.id,
      metric: c.metric,
      op: c.op,
      threshold: c.value,
      description: c.description,
      observed: observed === Number.POSITIVE_INFINITY ? 'inf' : observed,
      evaluable,
      triggered,
      pass: evaluable ? !triggered : false,
      note: evaluable
        ? null
        : `${c.metric} could not be computed from this run (${metrics.trade_count} trades), so the criterion `
          + 'is recorded as not passed rather than assumed survived',
    }
  })

  const inconclusive = criteria.some((c) => !c.evaluable)
  return {
    overall: criteria.every((c) => c.pass) ? 'pass' : 'killed',
    criteria,
    inconclusive,
    killed_by: criteria.filter((c) => !c.pass).map((c) => c.id),
    evaluated_at: new Date().toISOString(),
  }
}

const CSV_COLUMNS = [
  'coin', 'side', 'qty', 'notional_usd',
  'entry_signal_ts', 'entry_ts', 'entry_px', 'entry_raw_px', 'entry_source', 'entry_granularity',
  'exit_signal_ts', 'exit_ts', 'exit_px', 'exit_raw_px', 'exit_source', 'exit_granularity',
  'gross_pnl_usd', 'fees_usd', 'net_pnl_usd', 'hold_s', 'exit_reason',
  'delay_s', 'slippage_bps', 'taker_fee_pct',
]

export function tradesCsv(trades) {
  const escape = (v) => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [CSV_COLUMNS.join(',')]
  for (const t of trades) lines.push(CSV_COLUMNS.map((c) => escape(t[c])).join(','))
  return `${lines.join('\n')}\n`
}

const round4 = (n) => Math.round(n * 10_000) / 10_000
const round6 = (n) => Math.round(n * 1_000_000) / 1_000_000
