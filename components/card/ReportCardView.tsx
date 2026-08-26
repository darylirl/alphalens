'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Clapperboard } from 'lucide-react'
import { CopyableAddress } from '@/components/ui/CopyableAddress'
import { SkeletonCard } from '@/components/ui/SkeletonCard'
import { ARCHETYPE_CONTEXT, ARCHETYPE_LABELS, ARCHETYPE_STYLES } from '@/lib/archetypeContext'
import type { ReportCard, Grade } from '@/lib/wallet-data/card'

// The Wallet Report Card, client-rendered from /api/card/[address] so the
// shell paints immediately and the graded numbers stream in. Every number on
// this page carries its sample size and the coverage block that produced it;
// dimensions below the 30-round-trip floor render the honest "not enough
// history to grade" state instead of a grade.

const GRADE_COLOR: Record<Grade, string> = {
  A: 'text-[#34EAB9]',
  B: 'text-emerald-400',
  C: 'text-[#F5A623]',
  D: 'text-orange-400',
  F: 'text-[#FF3B5C]',
}

function fmtUsd(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e9) return `$${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `$${(abs / 1e3).toFixed(1)}K`
  return `$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function fmtSignedUsd(n: number): string {
  return `${n >= 0 ? '+' : '−'}${fmtUsd(n)}`
}

function fmtHold(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`
  return `${(seconds / 86400).toFixed(1)}d`
}

function fmtPct(x: number): string {
  return `${(x * 100).toFixed(1)}%`
}

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'up' | 'down' | 'plain'
}) {
  const color =
    tone === 'up' ? 'text-[#34EAB9]' : tone === 'down' ? 'text-[#FF3B5C]' : 'text-[#F0FAF8]'
  return (
    <div>
      <p className="text-[10px] text-white/40 uppercase tracking-wider">{label}</p>
      <p className={`font-mono text-base font-bold mt-0.5 ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-white/40 mt-0.5 leading-relaxed">{sub}</p>}
    </div>
  )
}

function GradeTile({ label, grade, sub }: { label: string; grade: Grade | null; sub: string }) {
  return (
    <div className="text-center">
      <p className="text-[10px] text-white/40 uppercase tracking-wider">{label}</p>
      <p
        className={`font-mono text-3xl font-bold mt-1 ${grade ? GRADE_COLOR[grade] : 'text-white/25'}`}
      >
        {grade ?? '—'}
      </p>
      <p className="text-[9px] text-white/35 mt-0.5">{sub}</p>
    </div>
  )
}

export function ReportCardView({ address }: { address: string }) {
  const [card, setCard] = useState<ReportCard | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let dead = false
    fetch(`/api/card/${address}`, { cache: 'no-store' })
      .then(async res => {
        const body = await res.json()
        if (dead) return
        if (!res.ok) setError(body?.error ?? `error ${res.status}`)
        else setCard(body as ReportCard)
      })
      .catch(() => {
        if (!dead) setError('Could not reach the card API just now.')
      })
    return () => {
      dead = true
    }
  }, [address])

  if (error) {
    return (
      <div className="card p-6 text-center">
        <p className="text-sm font-semibold mb-1">Report card unavailable</p>
        <p className="text-xs text-white/40">{error}</p>
        <p className="text-[10px] text-white/30 mt-2">
          Nothing is shown rather than a stale or invented card.
        </p>
      </div>
    )
  }

  if (!card) {
    return (
      <div className="space-y-4">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    )
  }

  const g = card.grades
  const perf = card.performance
  const beh = card.behavior
  const risk = card.risk
  const archetype = card.identity.archetype
  const ctx = archetype ? ARCHETYPE_CONTEXT[archetype] : null
  const n = g.closed_round_trips
  const sampleNote = `n = ${n.toLocaleString()} resolved round trips`

  return (
    <div className="space-y-4">
      {/* Identity */}
      <div className="card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {card.identity.label && (
              <p className="text-sm font-semibold mb-0.5">{card.identity.label}</p>
            )}
            <CopyableAddress address={card.address} linked={false} className="text-xs" />
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {archetype && (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${ARCHETYPE_STYLES[archetype] ?? ARCHETYPE_STYLES.unclassified}`}
              >
                {ARCHETYPE_LABELS[archetype] ?? archetype}
              </span>
            )}
            {card.identity.cohort_member && (
              <span
                className="text-[10px] font-mono font-bold uppercase tracking-wider border rounded px-2 py-0.5 text-[#34EAB9] border-[#34EAB9]/50"
                title="In our capture scope — this card is built from our stored fill history"
              >
                cohort
              </span>
            )}
          </div>
        </div>
        <p className="text-[10px] text-white/40 mt-2 leading-relaxed">{card.coverage.note}</p>
      </div>

      {/* Grades */}
      <div className="card p-4">
        <div className="flex items-baseline justify-between mb-3">
          <p className="text-xs font-semibold">Grades</p>
          <p className="text-[10px] text-white/40 font-mono">{sampleNote}</p>
        </div>
        {g.gradeable ? (
          <div className="grid grid-cols-4 gap-2">
            <GradeTile label="Overall" grade={g.overall} sub="composite" />
            <GradeTile label="Performance" grade={g.performance} sub="profit factor" />
            <GradeTile label="Behavior" grade={g.behavior} sub="sizing consistency" />
            <GradeTile label="Risk" grade={g.risk} sub="liquidations" />
          </div>
        ) : (
          <div className="text-center py-4">
            <p className="text-sm font-semibold text-white/60">Not enough history to grade</p>
            <p className="text-[11px] text-white/40 mt-1 leading-relaxed">
              {n.toLocaleString()} of {g.floor} resolved round-trip trades in the covered window.
              A grade on less would be a guess, so none is shown.
            </p>
          </div>
        )}
      </div>

      {/* Performance */}
      <div className="card p-4">
        <p className="text-xs font-semibold mb-3">Performance</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Metric
            label="All-time PnL"
            value={perf.all_time_pnl_usd === null ? '—' : fmtSignedUsd(perf.all_time_pnl_usd)}
            tone={
              perf.all_time_pnl_usd === null
                ? 'plain'
                : perf.all_time_pnl_usd >= 0
                  ? 'up'
                  : 'down'
            }
            sub={
              perf.all_time_pnl_usd === null
                ? 'portfolio endpoint did not answer'
                : "exchange's own allTime curve — not window arithmetic"
            }
          />
          <Metric
            label="Adjusted win rate"
            value={perf.win_rate_adjusted === null ? (perf.win_rate_raw === null ? '—' : fmtPct(perf.win_rate_raw)) : fmtPct(perf.win_rate_adjusted)}
            sub={
              perf.win_rate_adjusted !== null && perf.win_rate_raw !== null
                ? `raw ${fmtPct(perf.win_rate_raw)} · ${sampleNote}`
                : perf.win_rate_raw !== null
                  ? `raw, unadjusted · ${sampleNote}`
                  : 'no resolved round trips'
            }
          />
          <Metric
            label="Profit factor"
            value={
              perf.profit_factor !== null
                ? perf.profit_factor.toFixed(2)
                : perf.closed_round_trips > 0 && perf.gross_losses_usd === 0
                  ? '∞'
                  : '—'
            }
            sub={
              perf.profit_factor_note ??
              `${fmtUsd(perf.gross_wins_usd)} won / ${fmtUsd(perf.gross_losses_usd)} lost · ${sampleNote}`
            }
          />
        </div>
        {perf.win_rate_adjusted !== null && perf.win_rate_population_mean !== null && (
          <p className="text-[10px] text-white/40 mt-3 pt-3 border-t border-white/[0.08] leading-relaxed">
            &ldquo;Adjusted&rdquo; = empirical-Bayes shrinkage toward the cohort mean win rate (
            {fmtPct(perf.win_rate_population_mean)} across {perf.win_rate_population_n} measured
            wallets): small samples are pulled toward the population, large samples barely move.
            Prior strength {perf.win_rate_prior_strength} pseudo-trades.
          </p>
        )}
      </div>

      {/* Behavior */}
      <div className="card p-4">
        <p className="text-xs font-semibold mb-3">Behavior</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Metric
            label="Median hold"
            value={beh.median_hold_seconds === null ? '—' : fmtHold(beh.median_hold_seconds)}
            sub={
              beh.median_hold_seconds === null
                ? 'no fully-measured round trips'
                : `n = ${beh.hold_sample.toLocaleString()} measured trips`
            }
          />
          <Metric
            label="Trade frequency"
            value={
              beh.round_trips_per_day === null ? '—' : `${beh.round_trips_per_day.toFixed(1)}/day`
            }
            sub={
              beh.covered_days === null
                ? 'window too short to rate'
                : `round trips over ${beh.covered_days.toFixed(1)} covered days`
            }
          />
          <Metric
            label="Sizing consistency"
            value={beh.sizing_cv === null ? '—' : `CV ${beh.sizing_cv.toFixed(2)}`}
            sub={
              beh.sizing_cv === null
                ? 'needs 2+ round trips'
                : `spread of trip notional · n = ${beh.sizing_sample.toLocaleString()}` +
                  (beh.median_trip_notional_usd !== null
                    ? ` · median ${fmtUsd(beh.median_trip_notional_usd)}`
                    : '')
            }
          />
        </div>
      </div>

      {/* Risk */}
      <div className="card p-4">
        <p className="text-xs font-semibold mb-3">Risk</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Metric
            label="Max observed position"
            value={
              risk.max_observed_position_usd === null
                ? '—'
                : fmtUsd(risk.max_observed_position_usd)
            }
            sub={
              risk.max_observed_position_usd === null
                ? 'no fills in the covered window'
                : `${risk.max_observed_position_coin ?? ''} · peak in covered window` +
                  (risk.exposure_lower_bound
                    ? ' · lower bound (some history starts mid-position)'
                    : '')
            }
          />
          <Metric
            label="Liquidations"
            value={String(risk.liquidation_count)}
            tone={risk.liquidation_count > 0 ? 'down' : 'plain'}
            sub="liquidation fills in available history"
          />
          <Metric
            label="Open positions"
            value={String(risk.open_round_trips)}
            sub={card.coverage.open_positions_note ?? 'nothing open in the covered window'}
          />
        </div>
      </div>

      {/* See the film */}
      <Link
        href={`/replay/${card.address}`}
        className="card p-4 flex items-center justify-between gap-3 hover:border-[#34EAB9]/40 transition-colors"
      >
        <div>
          <p className="text-xs font-semibold flex items-center gap-1.5">
            <Clapperboard size={13} className="text-[#34EAB9]" /> See the film
          </p>
          <p className="text-[11px] text-white/55 mt-0.5 leading-relaxed">
            Replay this wallet&rsquo;s actual trades on the chart, at exchange-exact execution
            prices.
          </p>
        </div>
        <ArrowRight size={14} className="text-[#34EAB9] shrink-0" />
      </Link>

      {/* Copyability context */}
      <div className="card p-4">
        <p className="text-xs font-semibold mb-2">Before you think about copying this wallet</p>
        {ctx ? (
          <p className="text-[11px] text-white/55 leading-relaxed">
            {ctx.line}
            {ctx.fromResearch && (
              <>
                {' '}
                <Link
                  href="/research/copy-trading-autopsy"
                  className="text-[#34EAB9] hover:underline"
                >
                  The autopsy
                </Link>
              </>
            )}
          </p>
        ) : (
          <p className="text-[11px] text-white/55 leading-relaxed">
            We replayed 28,318 copied trades from classified wallets with honest frictions (60s
            delay, 5bps slippage, taker fees) and lost money.{' '}
            <Link href="/research/copy-trading-autopsy" className="text-[#34EAB9] hover:underline">
              The autopsy
            </Link>
          </p>
        )}
        <p className="text-[11px] text-white/40 leading-relaxed mt-3 pt-3 border-t border-white/[0.08]">
          This card grades measured history — it is not a list of wallets to follow and a grade is
          not a prediction. Nothing here is a recommendation or financial advice.
        </p>
      </div>

      {/* Methodology */}
      <div className="card p-4">
        <p className="text-xs font-semibold mb-2">How the grades are computed</p>
        <ul className="text-[10px] text-white/40 leading-relaxed space-y-1 list-disc pl-4">
          <li>
            No dimension is graded below {g.floor} resolved round-trip trades. A round trip spans
            flat → position → flat, reconstructed from the exchange&rsquo;s own signed positions.
          </li>
          <li>
            Performance maps profit factor to letters: ≥2.0 A, ≥1.5 B, ≥1.1 C, ≥0.9 D, below F.
          </li>
          <li>
            Behavior maps sizing spread (coefficient of variation of round-trip notional): ≤0.5 A,
            ≤1.0 B, ≤1.5 C, ≤2.5 D, above F.
          </li>
          <li>Risk maps liquidation count: 0 A, 1 C, 2–3 D, more F.</li>
          <li>Overall is the rounded average of the three. Fixed thresholds, stated so the grade is a mapping, not an opinion.</li>
        </ul>
      </div>
    </div>
  )
}
