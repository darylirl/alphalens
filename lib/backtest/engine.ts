/**
 * Client-side backtest engine with EMA/RSI indicators.
 * Runs entirely in the browser against Hyperliquid OHLCV candle data.
 */

export interface Candle {
  t: number   // open time (ms)
  T: number   // close time (ms)
  o: number   // open
  h: number   // high
  l: number   // low
  c: number   // close
  v: number   // volume
}

export interface BacktestTrade {
  entryTime: number
  entryPrice: number
  exitTime: number
  exitPrice: number
  side: 'Long' | 'Short'
  sizeUsd: number
  pnl: number
  fees: number
}

export interface BacktestConfig {
  strategy: 'momentum' | 'mean_reversion'
  positionSizeUsd: number
  takerFeePct: number  // default 0.035%
}

export interface BacktestResults {
  trades: BacktestTrade[]
  equityCurve: Array<{ date: string; pnl: number }>
  totalPnl: number
  totalReturn: number
  tradeCount: number
  winRate: number
  maxDrawdown: number
  sharpe: number
}

// ─── Indicators ─────────────────────────────────────────────────────

export function computeEMA(closes: number[], period: number): number[] {
  const ema: number[] = new Array(closes.length).fill(0)
  if (closes.length === 0) return ema

  // Seed with SMA of first `period` values
  let sum = 0
  for (let i = 0; i < Math.min(period, closes.length); i++) {
    sum += closes[i]
  }
  ema[Math.min(period - 1, closes.length - 1)] = sum / Math.min(period, closes.length)

  const k = 2 / (period + 1)
  for (let i = period; i < closes.length; i++) {
    ema[i] = closes[i] * k + ema[i - 1] * (1 - k)
  }

  // Fill leading values with 0 (not enough data)
  for (let i = 0; i < period - 1 && i < closes.length; i++) {
    ema[i] = 0
  }

  return ema
}

export function computeRSI(closes: number[], period: number = 14): number[] {
  const rsi: number[] = new Array(closes.length).fill(50) // neutral default

  if (closes.length < period + 1) return rsi

  let avgGain = 0
  let avgLoss = 0

  // Calculate initial average gain/loss
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1]
    if (change > 0) avgGain += change
    else avgLoss += Math.abs(change)
  }
  avgGain /= period
  avgLoss /= period

  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)

  // Smoothed RSI for subsequent values
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1]
    const gain = change > 0 ? change : 0
    const loss = change < 0 ? Math.abs(change) : 0

    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period

    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }

  return rsi
}

// ─── Backtest Engine ────────────────────────────────────────────────

export function runBacktest(candles: Candle[], config: BacktestConfig): BacktestResults {
  const { strategy, positionSizeUsd, takerFeePct } = config
  const feeRate = takerFeePct / 100
  const closes = candles.map(c => c.c)
  const trades: BacktestTrade[] = []

  let inPosition = false
  let entryIdx = 0
  let entryPrice = 0

  if (strategy === 'momentum') {
    // Momentum: long when close > EMA(20), exit when close < EMA(20)
    const ema20 = computeEMA(closes, 20)

    for (let i = 20; i < candles.length; i++) {
      if (!inPosition && closes[i] > ema20[i] && ema20[i] > 0) {
        // Enter long
        inPosition = true
        entryIdx = i
        entryPrice = closes[i]
      } else if (inPosition && closes[i] < ema20[i]) {
        // Exit long
        const exitPrice = closes[i]
        const qty = positionSizeUsd / entryPrice
        const grossPnl = (exitPrice - entryPrice) * qty
        const fees = positionSizeUsd * feeRate * 2 // entry + exit
        trades.push({
          entryTime: candles[entryIdx].t,
          entryPrice,
          exitTime: candles[i].t,
          exitPrice,
          side: 'Long',
          sizeUsd: positionSizeUsd,
          pnl: Math.round((grossPnl - fees) * 100) / 100,
          fees: Math.round(fees * 100) / 100,
        })
        inPosition = false
      }
    }
  } else if (strategy === 'mean_reversion') {
    // Mean Reversion: long when RSI < 30, exit when RSI > 50
    const rsi14 = computeRSI(closes, 14)

    for (let i = 15; i < candles.length; i++) {
      if (!inPosition && rsi14[i] < 30) {
        // Enter long on oversold
        inPosition = true
        entryIdx = i
        entryPrice = closes[i]
      } else if (inPosition && rsi14[i] > 50) {
        // Exit on mean recovery
        const exitPrice = closes[i]
        const qty = positionSizeUsd / entryPrice
        const grossPnl = (exitPrice - entryPrice) * qty
        const fees = positionSizeUsd * feeRate * 2
        trades.push({
          entryTime: candles[entryIdx].t,
          entryPrice,
          exitTime: candles[i].t,
          exitPrice,
          side: 'Long',
          sizeUsd: positionSizeUsd,
          pnl: Math.round((grossPnl - fees) * 100) / 100,
          fees: Math.round(fees * 100) / 100,
        })
        inPosition = false
      }
    }
  }

  // Close any open position at the last candle
  if (inPosition && candles.length > 0) {
    const lastCandle = candles[candles.length - 1]
    const exitPrice = lastCandle.c
    const qty = positionSizeUsd / entryPrice
    const grossPnl = (exitPrice - entryPrice) * qty
    const fees = positionSizeUsd * feeRate * 2
    trades.push({
      entryTime: candles[entryIdx].t,
      entryPrice,
      exitTime: lastCandle.t,
      exitPrice,
      side: 'Long',
      sizeUsd: positionSizeUsd,
      pnl: Math.round((grossPnl - fees) * 100) / 100,
      fees: Math.round(fees * 100) / 100,
    })
  }

  // Build equity curve (daily cumulative PnL)
  const dailyPnl = new Map<string, number>()
  // Seed all candle dates with 0
  for (const c of candles) {
    const date = new Date(c.t).toISOString().split('T')[0]
    if (!dailyPnl.has(date)) dailyPnl.set(date, 0)
  }
  for (const trade of trades) {
    const date = new Date(trade.exitTime).toISOString().split('T')[0]
    dailyPnl.set(date, (dailyPnl.get(date) || 0) + trade.pnl)
  }

  const sortedDays = Array.from(dailyPnl.entries()).sort(([a], [b]) => a.localeCompare(b))
  let cumPnl = 0
  const equityCurve = sortedDays.map(([date, pnl]) => {
    cumPnl += pnl
    return { date, pnl: Math.round(cumPnl * 100) / 100 }
  })

  // Compute statistics
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0)
  const wins = trades.filter(t => t.pnl > 0).length
  const winRate = trades.length > 0 ? wins / trades.length : 0

  // Max drawdown from equity curve
  let peak = 0
  let maxDrawdown = 0
  for (const point of equityCurve) {
    if (point.pnl > peak) peak = point.pnl
    const dd = peak - point.pnl
    if (dd > maxDrawdown) maxDrawdown = dd
  }

  // Sharpe ratio (annualized, daily returns)
  const dailyReturns = sortedDays.map(([, pnl]) => pnl)
  const mean = dailyReturns.length > 0
    ? dailyReturns.reduce((s, v) => s + v, 0) / dailyReturns.length
    : 0
  const variance = dailyReturns.length > 1
    ? dailyReturns.reduce((s, v) => s + (v - mean) ** 2, 0) / (dailyReturns.length - 1)
    : 0
  const std = Math.sqrt(variance)
  const sharpe = std > 0 ? Math.round((mean / std) * Math.sqrt(365) * 100) / 100 : 0

  // Total return percentage
  const totalReturn = positionSizeUsd > 0
    ? Math.round((totalPnl / positionSizeUsd) * 10000) / 100
    : 0

  return {
    trades,
    equityCurve,
    totalPnl: Math.round(totalPnl * 100) / 100,
    totalReturn,
    tradeCount: trades.length,
    winRate: Math.round(winRate * 1000) / 1000,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    sharpe,
  }
}
