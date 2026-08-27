import type { Fill } from '@/lib/hyperliquid/types'

/**
 * Discontinuities in a wallet's served fill series.
 *
 * A stretch with no fills in it is TWO different claims wearing one face:
 *
 *   - the wallet did not trade (a real measurement — capture was healthy and
 *     nothing happened), or
 *   - we did not measure (absence of measurement).
 *
 * Reading the second as the first is the same error as reading a missing
 * bucket as `0`, and this module exists so no surface has to guess. Only one
 * of the two can be PROVEN from the fills themselves, and the exchange proves
 * it for us: every fill carries `startPosition`, the position the wallet held
 * before that fill. When the position implied by the last fill before a
 * stretch disagrees with the `startPosition` reported by the first fill after
 * it, fills happened in between that we never saw. That is proof — not an
 * inference from silence.
 *
 * A quiet stretch WITHOUT a position break proves nothing either way, so it
 * is reported as `kind: 'quiet'` and must never be drawn as a gap. Unconfirmed
 * absence and proven absence are different claims; only the proven one earns
 * a seam.
 *
 * ── Why positions are reconstructed per BURST, not per fill ────────────────
 *
 * Fills are not individually ordered inside a millisecond and `tid` is not an
 * execution sequence. Measured on the fixture wallet
 * (0x020ca6…5872), nine ETH fills share the timestamp 2026-05-01T12:11:35.132
 * with start positions interleaved 10200 → 10234 in tid order. Differencing
 * fill-by-fill in tid order therefore reports a "break" almost everywhere:
 * 206,433 of 212,000 boundaries, all of them noise. Grouping fills by exact
 * timestamp and reconstructing the burst's endpoints collapses that to 30
 * boundaries in 12,528 bursts — and the two known capture gaps for that
 * wallet are the top two by unexplained size.
 *
 * Inside a burst the entry order is unknowable, so the burst is anchored by
 * its net direction: a net-buying burst starts at the smallest reported start
 * position, a net-selling burst at the largest, and ends at that anchor plus
 * the burst's net size. For a uniform-direction burst this is exact; for a
 * mixed one it can be off by the burst's own internal swing, which is why a
 * gap claim also has to clear both thresholds below.
 */

/** A stretch shorter than this is never reported, whatever the arithmetic
 *  says. Capture writes continuously, so a real coverage hole is hours or
 *  days; a sub-hour position discrepancy is burst-ordering noise or an
 *  exchange-side position change, not a hole in our measurement. */
export const GAP_MIN_MS = 60 * 60_000

/** A quiet stretch is worth REPORTING (never drawing) from here up. */
export const QUIET_MIN_MS = 24 * 60 * 60_000

/** Relative tolerance on the position comparison, with an absolute floor so
 *  a near-flat position cannot make the threshold vanish. */
const relTol = (position: number) => Math.max(Math.abs(position), 1) * 1e-4

export type GapKind = 'position_break' | 'quiet'

export interface SeriesGap {
  /** Last fill before the stretch, ms. */
  from: number
  /** First fill after the stretch, ms. */
  to: number
  duration_ms: number
  /** The coin whose position break proves the gap; null for a quiet stretch
   *  in a mixed-coin series. */
  coin: string | null
  /** Position change across the stretch that no served fill explains, in
   *  coins. Null for a quiet stretch — nothing is proven, so nothing is
   *  quantified. */
  unexplained_coins: number | null
  /**
   * 'position_break' — the exchange's own start positions prove fills we
   * never saw. This is the only kind any user-facing surface may draw.
   * 'quiet' — no fills for a long stretch, which we cannot distinguish from
   * the wallet simply not trading. Reported for context, never rendered as
   * a gap and never subtracted from covered time.
   */
  kind: GapKind
}

interface Burst {
  t: number
  /** Position entering the burst and leaving it, reconstructed. */
  start: number
  end: number
}

const signed = (f: Fill) => (f.side === 'B' ? Number(f.sz) : -Number(f.sz))

/** Bursts of one coin's fills, ascending. Fills whose `startPosition` the
 *  source did not report are skipped: an unreported position cannot prove
 *  anything, and guessing one would manufacture the very claim this module
 *  exists to withhold. */
function burstsOf(fills: Fill[]): Burst[] {
  const byTime = new Map<number, Fill[]>()
  for (const f of fills) {
    const start = parseFloat(f.startPosition)
    if (!Number.isFinite(start) || !Number.isFinite(Number(f.sz))) continue
    const held = byTime.get(f.time)
    if (held) held.push(f)
    else byTime.set(f.time, [f])
  }
  const out: Burst[] = []
  for (const t of [...byTime.keys()].sort((a, b) => a - b)) {
    const group = byTime.get(t)!
    let net = 0
    let lo = Infinity
    let hi = -Infinity
    for (const f of group) {
      net += signed(f)
      const s = parseFloat(f.startPosition)
      if (s < lo) lo = s
      if (s > hi) hi = s
    }
    const start = net >= 0 ? lo : hi
    out.push({ t, start, end: start + net })
  }
  return out
}

/** Proven gaps in ONE coin's series, ascending by time. */
export function coinGaps(coin: string, fills: Fill[]): SeriesGap[] {
  const bursts = burstsOf(fills)
  const out: SeriesGap[] = []
  for (let i = 1; i < bursts.length; i++) {
    const prev = bursts[i - 1]
    const next = bursts[i]
    const duration = next.t - prev.t
    if (duration < GAP_MIN_MS) continue
    const unexplained = next.start - prev.end
    if (Math.abs(unexplained) <= relTol(prev.end)) continue
    out.push({
      from: prev.t,
      to: next.t,
      duration_ms: duration,
      coin,
      unexplained_coins: unexplained,
      kind: 'position_break',
    })
  }
  return out
}

/** Proven gaps per coin over a mixed series. */
export function gapsByCoin(fills: Fill[]): Map<string, SeriesGap[]> {
  const byCoin = new Map<string, Fill[]>()
  for (const f of fills) {
    const held = byCoin.get(f.coin)
    if (held) held.push(f)
    else byCoin.set(f.coin, [f])
  }
  const out = new Map<string, SeriesGap[]>()
  for (const [coin, coinFills] of byCoin) out.set(coin, coinGaps(coin, coinFills))
  return out
}

/**
 * Gaps in the WALLET's series (every coin together).
 *
 * A coin's position break only proves that fills are missing somewhere inside
 * its own stretch — not that the whole stretch is unmeasured. The fixture
 * makes the difference concrete: HYPE's break runs 2026-05-13 → 2026-08-19
 * and swallows four short July/August stretches during which ETH fills were
 * captured normally. Those stretches are quiet, not uncovered.
 *
 * So a wallet-level stretch is proven only when a coin's break is bounded
 * EXACTLY by it — the coin's own neighbouring fills are the wallet's
 * neighbouring fills — which places the unseen fills strictly inside the
 * stretch and nowhere else.
 */
export function walletGaps(fills: Fill[]): SeriesGap[] {
  const sorted = [...fills].sort((a, b) => a.time - b.time)
  const proven = new Map<string, SeriesGap>()
  for (const gaps of gapsByCoin(sorted).values()) {
    for (const g of gaps) proven.set(`${g.from}:${g.to}`, g)
  }

  const out: SeriesGap[] = []
  for (let i = 1; i < sorted.length; i++) {
    const from = sorted[i - 1].time
    const to = sorted[i].time
    const duration = to - from
    if (duration < GAP_MIN_MS) continue
    const hit = proven.get(`${from}:${to}`)
    if (hit) {
      out.push({ ...hit, from, to, duration_ms: duration })
      continue
    }
    if (duration >= QUIET_MIN_MS) {
      out.push({
        from,
        to,
        duration_ms: duration,
        coin: null,
        unexplained_coins: null,
        kind: 'quiet',
      })
    }
  }
  return out
}

/** The gaps a surface may draw: proven ones only. */
export const drawable = (gaps: SeriesGap[]): SeriesGap[] =>
  gaps.filter(g => g.kind === 'position_break')

/** Time actually measured inside [from, to]: the span minus proven gaps.
 *  Quiet stretches are NOT subtracted — nothing says they were unmeasured. */
export function coveredMs(fromMs: number, toMs: number, gaps: SeriesGap[]): number {
  const span = Math.max(toMs - fromMs, 0)
  const lost = drawable(gaps).reduce((a, g) => a + g.duration_ms, 0)
  return Math.max(span - lost, 0)
}

const days = (ms: number) => `${(ms / 86_400_000).toFixed(1)} d`

/**
 * The clause a coverage note carries when its window is not what it looks
 * like. Null when the window is continuous, so callers can append blindly.
 */
export function gapNote(gaps: SeriesGap[]): string | null {
  const hard = drawable(gaps)
  const quiet = gaps.filter(g => g.kind === 'quiet')
  if (hard.length === 0 && quiet.length === 0) return null
  const parts: string[] = []
  if (hard.length > 0) {
    const spans = hard
      .slice()
      .sort((a, b) => b.duration_ms - a.duration_ms)
      .slice(0, 3)
      .map(g => days(g.duration_ms))
      .join(', ')
    parts.push(
      `NOT a continuous window: ${hard.length} proven gap${hard.length === 1 ? '' : 's'} inside it (${spans}${hard.length > 3 ? ', …' : ''}) where the exchange's own start positions show fills we never captured — totals here are sums over the rows we hold, not measurements of the whole span`
    )
  }
  if (quiet.length > 0) {
    parts.push(
      `${quiet.length} stretch${quiet.length === 1 ? '' : 'es'} of ${QUIET_MIN_MS / 3_600_000}h+ with no fills and no position break — consistent with the wallet not trading, and not counted as missing data`
    )
  }
  return parts.join('; ')
}
