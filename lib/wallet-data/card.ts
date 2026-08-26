import { getSupabase } from '@/lib/db/supabase'
import { computeTradeGroups, type TradeGroup } from '@/lib/wallets/classify'
import type { Fill, PortfolioEntry } from '@/lib/hyperliquid/types'
import { loadWalletFills, type FillsCoverage, type WalletRow } from './fills'

// The Wallet Report Card, built server-side and shared by the /card page, the
// public JSON endpoint, and the OG share image — one builder so the three can
// never disagree.
//
// Honesty rules baked in here:
// - All-time PnL comes from the exchange's own portfolio endpoint (allTime
//   curve), never from summing a fill window — a window sum is not "all time".
// - No grade on any dimension below GRADE_FLOOR resolved round trips; the
//   honest "not enough history to grade" state renders instead.
// - Win rate is shown with empirical-Bayes shrinkage toward the cohort
//   population mean; the raw rate, the sample size, the population mean and
//   the prior strength are all in the payload so the adjustment is auditable.
// - Every number carries its sample size and the fills coverage block.

export const CARD_SCHEMA = 'card.v0'

/** Minimum resolved round trips before any dimension is graded. */
export const GRADE_FLOOR = 30

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F'

export interface GradeBlock {
  gradeable: boolean
  floor: number
  closed_round_trips: number
  performance: Grade | null
  behavior: Grade | null
  risk: Grade | null
  overall: Grade | null
}

export interface ReportCard {
  address: string
  generated_at: string
  identity: {
    label: string | null
    archetype: string | null
    cohort_member: boolean
  }
  performance: {
    all_time_pnl_usd: number | null
    all_time_pnl_source: 'exchange_portfolio' | null
    win_rate_raw: number | null
    win_rate_adjusted: number | null
    win_rate_population_mean: number | null
    win_rate_prior_strength: number | null
    win_rate_population_n: number | null
    profit_factor: number | null
    profit_factor_note: string | null
    gross_wins_usd: number
    gross_losses_usd: number
    closed_round_trips: number
  }
  behavior: {
    median_hold_seconds: number | null
    hold_sample: number
    round_trips_per_day: number | null
    covered_days: number | null
    sizing_cv: number | null
    sizing_sample: number
    median_trip_notional_usd: number | null
  }
  risk: {
    max_observed_position_usd: number | null
    max_observed_position_coin: string | null
    /** True when part of the history begins mid-position, so the peak is a
     *  lower bound on what the wallet actually carried. */
    exposure_lower_bound: boolean
    liquidation_count: number
    open_round_trips: number
  }
  grades: GradeBlock
  coverage: FillsCoverage & {
    gap_coins: string[]
    open_positions_note: string | null
  }
}

// ---------------------------------------------------------------------------

const HL_URL = 'https://api.hyperliquid.xyz/info'

/** True all-time PnL from the exchange's portfolio endpoint. Null when the
 *  endpoint does not answer — never substituted with window arithmetic. */
export async function loadAllTimePnl(address: string): Promise<number | null> {
  try {
    const res = await fetch(HL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'portfolio', user: address }),
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = (await res.json()) as PortfolioEntry[]
    if (!Array.isArray(data)) return null
    const allTime = data.find(([key]) => key === 'allTime')
    const history = allTime?.[1]?.pnlHistory
    if (!Array.isArray(history) || history.length === 0) return null
    const last = Number(history[history.length - 1]?.[1])
    return Number.isFinite(last) ? last : null
  } catch {
    return null
  }
}

interface Population {
  mean: number
  priorStrength: number
  n: number
}

/**
 * Cohort win-rate population for the shrinkage prior: every stored round-trip
 * win rate across cohort wallets (real measurements written by the
 * classifier, null where a wallet has no closed trips). Paged read.
 *
 * Prior strength by method of moments on the population spread: a tight
 * population means a strong prior, a loose one a weak prior. Clamped so a
 * degenerate variance cannot make the prior infinite or useless.
 */
async function loadWinRatePopulation(): Promise<Population | null> {
  try {
    const supabase = getSupabase()
    const PAGE = 500
    const rates: number[] = []
    for (let offset = 0; offset < 5000; offset += PAGE) {
      const { data, error } = await supabase
        .from('wallets')
        .select('win_rate')
        .eq('capture_enabled', true)
        .is('removed_at', null)
        .not('win_rate', 'is', null)
        .order('address', { ascending: true })
        .range(offset, offset + PAGE - 1)
      if (error) throw error
      const page = (data ?? []) as { win_rate: number }[]
      for (const r of page) {
        const v = Number(r.win_rate)
        if (Number.isFinite(v) && v >= 0 && v <= 1) rates.push(v)
      }
      if (page.length < PAGE) break
    }
    if (rates.length < 10) return null
    const mean = rates.reduce((a, b) => a + b, 0) / rates.length
    const variance = rates.reduce((a, b) => a + (b - mean) ** 2, 0) / rates.length
    const raw = variance > 0 ? (mean * (1 - mean)) / variance - 1 : 200
    const priorStrength = Math.round(Math.min(Math.max(raw, 10), 200))
    return { mean, priorStrength, n: rates.length }
  } catch {
    return null
  }
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// Grade thresholds — fixed and documented on the page, so a grade is a stated
// mapping from measured numbers, not an opinion.
function gradePerformance(profitFactor: number | null, allWins: boolean): Grade {
  if (profitFactor === null) return allWins ? 'A' : 'F'
  if (profitFactor >= 2.0) return 'A'
  if (profitFactor >= 1.5) return 'B'
  if (profitFactor >= 1.1) return 'C'
  if (profitFactor >= 0.9) return 'D'
  return 'F'
}

function gradeBehavior(sizingCv: number | null): Grade | null {
  if (sizingCv === null) return null
  if (sizingCv <= 0.5) return 'A'
  if (sizingCv <= 1.0) return 'B'
  if (sizingCv <= 1.5) return 'C'
  if (sizingCv <= 2.5) return 'D'
  return 'F'
}

function gradeRisk(liquidations: number): Grade {
  if (liquidations === 0) return 'A'
  if (liquidations === 1) return 'C'
  if (liquidations <= 3) return 'D'
  return 'F'
}

const GRADE_VALUE: Record<Grade, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 }
const GRADE_FROM_VALUE: Grade[] = ['F', 'D', 'C', 'B', 'A']

function overallGrade(grades: (Grade | null)[]): Grade | null {
  const present = grades.filter((g): g is Grade => g !== null)
  if (present.length === 0) return null
  const avg = present.reduce((a, g) => a + GRADE_VALUE[g], 0) / present.length
  return GRADE_FROM_VALUE[Math.round(avg)]
}

const isLiquidation = (f: Fill) => /liquidat/i.test(f.dir || '')

export async function buildReportCard(address: string): Promise<ReportCard> {
  const [allTimePnl, walletFills, population] = await Promise.all([
    loadAllTimePnl(address),
    loadWalletFills(address),
    loadWinRatePopulation(),
  ])
  const { fills, coverage, isCohort, gapCoins } = walletFills
  const wallet: WalletRow | null = walletFills.wallet

  const groups = computeTradeGroups(fills)
  const closed = groups.filter(g => g.exitTime !== null)
  const open = groups.filter(g => g.exitTime === null)
  const n = closed.length

  // Performance ------------------------------------------------------------
  const wins = closed.filter(g => g.closedPnl > 0).length
  const winRateRaw = n > 0 ? wins / n : null
  let winRateAdjusted: number | null = null
  if (winRateRaw !== null && population) {
    winRateAdjusted =
      (wins + population.priorStrength * population.mean) / (n + population.priorStrength)
  }
  const grossWins = closed.reduce((a, g) => a + (g.closedPnl > 0 ? g.closedPnl : 0), 0)
  const grossLosses = closed.reduce((a, g) => a + (g.closedPnl < 0 ? -g.closedPnl : 0), 0)
  let profitFactor: number | null = null
  let profitFactorNote: string | null = null
  if (n === 0) {
    profitFactorNote = 'no resolved round trips in the covered window'
  } else if (grossLosses > 0) {
    profitFactor = grossWins / grossLosses
  } else {
    profitFactorNote = 'no losing round trips in the covered window — profit factor is undefined'
  }

  // Behavior ---------------------------------------------------------------
  const measured = closed.filter(g => !g.truncated)
  const holds = measured.map(g => ((g.exitTime as number) - g.entryTime) / 1000)
  const medianHold = median(holds)
  const notionals = closed.map(g => g.notional).filter(v => v > 0)
  let sizingCv: number | null = null
  if (notionals.length >= 2) {
    const m = notionals.reduce((a, b) => a + b, 0) / notionals.length
    const sd = Math.sqrt(notionals.reduce((a, b) => a + (b - m) ** 2, 0) / notionals.length)
    sizingCv = m > 0 ? sd / m : null
  }
  let coveredDays: number | null = null
  let tripsPerDay: number | null = null
  if (fills.length >= 2) {
    coveredDays = Math.max((fills[fills.length - 1].time - fills[0].time) / 86_400_000, 1 / 24)
    tripsPerDay = n / coveredDays
  }

  // Risk -------------------------------------------------------------------
  let maxExposure: number | null = null
  let maxExposureCoin: string | null = null
  const running = new Map<string, number>()
  for (const f of fills) {
    const sz = parseFloat(f.sz)
    const px = parseFloat(f.px)
    if (!Number.isFinite(sz) || !Number.isFinite(px)) continue
    const delta = f.side === 'B' ? sz : -sz
    const reported = parseFloat(f.startPosition)
    const prev = Number.isFinite(reported) ? reported : (running.get(f.coin) ?? 0)
    const next = prev + delta
    running.set(f.coin, next)
    const exposure = Math.abs(next) * px
    if (maxExposure === null || exposure > maxExposure) {
      maxExposure = exposure
      maxExposureCoin = f.coin
    }
  }
  const truncatedAny = groups.some(g => g.truncated) || gapCoins.length > 0
  const liquidationCount = fills.filter(isLiquidation).length

  // Grades -----------------------------------------------------------------
  const gradeable = n >= GRADE_FLOOR
  const perfGrade = gradeable ? gradePerformance(profitFactor, grossLosses === 0 && wins > 0) : null
  const behaviorGrade = gradeable ? gradeBehavior(sizingCv) : null
  const riskGrade = gradeable ? gradeRisk(liquidationCount) : null

  return {
    address: address.toLowerCase(),
    generated_at: new Date().toISOString(),
    identity: {
      label: wallet?.label ?? null,
      archetype: wallet?.archetype ?? null,
      cohort_member: isCohort,
    },
    performance: {
      all_time_pnl_usd: allTimePnl,
      all_time_pnl_source: allTimePnl === null ? null : 'exchange_portfolio',
      win_rate_raw: winRateRaw,
      win_rate_adjusted: winRateAdjusted,
      win_rate_population_mean: population?.mean ?? null,
      win_rate_prior_strength: population?.priorStrength ?? null,
      win_rate_population_n: population?.n ?? null,
      profit_factor: profitFactor,
      profit_factor_note: profitFactorNote,
      gross_wins_usd: grossWins,
      gross_losses_usd: grossLosses,
      closed_round_trips: n,
    },
    behavior: {
      median_hold_seconds: medianHold === null ? null : Math.round(medianHold),
      hold_sample: measured.length,
      round_trips_per_day: tripsPerDay,
      covered_days: coveredDays,
      sizing_cv: sizingCv,
      sizing_sample: notionals.length,
      median_trip_notional_usd: median(notionals),
    },
    risk: {
      max_observed_position_usd: maxExposure,
      max_observed_position_coin: maxExposureCoin,
      exposure_lower_bound: truncatedAny,
      liquidation_count: liquidationCount,
      open_round_trips: open.length,
    },
    grades: {
      gradeable,
      floor: GRADE_FLOOR,
      closed_round_trips: n,
      performance: perfGrade,
      behavior: behaviorGrade,
      risk: riskGrade,
      overall: gradeable ? overallGrade([perfGrade, behaviorGrade, riskGrade]) : null,
    },
    coverage: {
      ...coverage,
      gap_coins: gapCoins,
      open_positions_note:
        open.length > 0
          ? `${open.length} position${open.length === 1 ? '' : 's'} still open — excluded from every graded number`
          : null,
    },
  }
}

export type { TradeGroup }
