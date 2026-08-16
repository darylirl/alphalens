/**
 * Indicator series for rule grammar v1. Every series is aligned to the bar
 * array index and holds `null` for bars where the indicator is not yet defined
 * — a rule reading a null is NOT evaluable, which is how warm-up periods stop
 * the engine from emitting signals it has no evidence for.
 */

/** Exponential moving average, seeded with the SMA of the first `period` closes. */
export function ema(closes, period) {
  const out = new Array(closes.length).fill(null)
  if (closes.length < period) return out
  const k = 2 / (period + 1)
  let sum = 0
  for (let i = 0; i < period; i++) sum += closes[i]
  let prev = sum / period
  out[period - 1] = prev
  for (let i = period; i < closes.length; i++) {
    prev = closes[i] * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

/** Wilder-smoothed RSI. */
export function rsi(closes, period) {
  const out = new Array(closes.length).fill(null)
  if (closes.length <= period) return out
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d >= 0) gain += d
    else loss -= d
  }
  gain /= period
  loss /= period
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    gain = (gain * (period - 1) + (d > 0 ? d : 0)) / period
    loss = (loss * (period - 1) + (d < 0 ? -d : 0)) / period
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)
  }
  return out
}

/** Percent change of close over `lookback` bars. */
export function priceChangePct(closes, lookback) {
  const out = new Array(closes.length).fill(null)
  for (let i = lookback; i < closes.length; i++) {
    const base = closes[i - lookback]
    out[i] = base === 0 ? null : ((closes[i] / base) - 1) * 100
  }
  return out
}
