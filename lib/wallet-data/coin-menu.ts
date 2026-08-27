import { getSupabase } from '@/lib/db/supabase'
import {
  loadWalletRow,
  loadWalletFills,
  loadGapCoins,
  type FillsCoverage,
  type WalletRow,
} from './fills'
import { gapsByCoin, drawable, gapNote, type SeriesGap } from './gaps'
import type { Fill } from '@/lib/hyperliquid/types'

// The replay coin menu: per-coin trade counts, spans and realized PnL for a
// wallet, fast enough to be the page's first paint (Replay v2.2). Two paths,
// same rule as the fills reader:
//
// - Cohort wallets: ONE SQL aggregate (`replay_coin_menu`, migration 023)
//   over the wallet's captured rows — the aggregate is pushed into the
//   database instead of paging 20K fills through PostgREST, so the menu does
//   not pay the cold path it exists to remove. The RPC returns at most 200
//   coins (most-traded first); hitting that cap is declared.
// - Pasted wallets: the exchange's recent window, loaded once and grouped
//   in-process. The window is labelled as such, never presented as history.
//
// Sparklines ride along only where they are free: the exchange path already
// holds every fill, so a cumulative realized-PnL line costs nothing; the
// cohort aggregate does not return fills, and we do not page them to fake one.
//
// Both a coin's date range and its realized total read as claims about a
// continuous window, so both travel with that coin's PROVEN gaps
// (`replay_coin_gaps`, migration 024 — a second aggregate, for the same
// reason the first one exists). A quiet coin is not a gapped one and never
// carries a marker.

/** RPC caps its result at this many coins; the loader declares when hit. */
const MENU_COIN_CAP = 200

/** Sparkline sample budget — cumulative realized PnL, at most this many points. */
const SPARK_POINTS = 24

export interface CoinMenuEntry {
  coin: string
  fills: number
  /** First and last fill held for this coin, ms. These are the ENDS of the
   *  series, not a statement that everything between them was measured —
   *  `gaps` says what sits inside. */
  from: number
  to: number
  /** Sum of exchange-reported realized PnL over the fills held for this coin.
   *  With a non-empty `gaps` this is a sum over what we hold, not a total for
   *  the span. */
  realized_pnl: number
  /** Proven discontinuities in this coin's series. Empty for a continuous
   *  one; quiet stretches never appear here. */
  gaps: SeriesGap[]
  /** Cumulative realized PnL samples over the window, oldest first — only
   *  where the fills were already in hand (exchange path); never fabricated. */
  spark: number[] | null
}

export interface CoinMenu {
  coins: CoinMenuEntry[]
  coverage: FillsCoverage
  isCohort: boolean
  wallet: WalletRow | null
  gapCoins: string[]
  /** True when the store aggregate hit its coin cap — more coins exist. */
  coinsCapped: boolean
}

interface MenuRpcRow {
  coin: string
  fill_count: number
  first_fill: string
  last_fill: string
  realized_pnl: number
}

interface GapRpcRow {
  coin: string
  gap_from: string
  gap_to: string
  unexplained_coins: number
}

const fmtDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Cumulative realized PnL over one coin's fills, sampled evenly (last point
 *  always the final total). Real sums of real fills — just fewer points. */
function sparkOf(fills: Fill[]): number[] {
  const cum: number[] = []
  let s = 0
  for (const f of fills) {
    s += Number(f.closedPnl) || 0
    cum.push(s)
  }
  if (cum.length <= SPARK_POINTS) return cum
  const out: number[] = []
  for (let i = 0; i < SPARK_POINTS; i++) {
    out.push(cum[Math.floor((i * (cum.length - 1)) / (SPARK_POINTS - 1))])
  }
  return out
}

/** Group already-loaded fills (ascending by time) into menu entries. */
function entriesFromFills(fills: Fill[]): CoinMenuEntry[] {
  const gaps = gapsByCoin(fills)
  const byCoin = new Map<string, Fill[]>()
  for (const f of fills) {
    const held = byCoin.get(f.coin)
    if (held) held.push(f)
    else byCoin.set(f.coin, [f])
  }
  return [...byCoin.entries()]
    .map(([coin, coinFills]) => ({
      coin,
      fills: coinFills.length,
      from: coinFills[0].time,
      to: coinFills[coinFills.length - 1].time,
      realized_pnl: coinFills.reduce((s, f) => s + (Number(f.closedPnl) || 0), 0),
      gaps: drawable(gaps.get(coin) ?? []),
      spark: sparkOf(coinFills),
    }))
    .sort((a, b) => b.fills - a.fills)
}

export async function loadCoinMenu(address: string): Promise<CoinMenu> {
  // All three reads are keyed on the address alone, so they go together:
  // waiting for the wallets row before starting the aggregate put a round
  // trip in front of the page's first paint for nothing. A wallet that
  // turns out not to be cohort simply discards a cheap indexed lookup that
  // found nothing.
  const supabase = getSupabase()
  const [wallet, menuRes, coinGapsRes, gapCoins] = await Promise.all([
    loadWalletRow(address),
    supabase
      .rpc('replay_coin_menu', { p_wallet: address.toLowerCase() })
      .then(r => r, (e: unknown) => ({ data: null, error: e as { message: string } })),
    supabase
      .rpc('replay_coin_gaps', { p_wallet: address.toLowerCase() })
      .then(r => r, (e: unknown) => ({ data: null, error: e as { message: string } })),
    loadGapCoins(address),
  ])
  const isCohort = Boolean(wallet?.capture_enabled)

  if (isCohort) {
    try {
      const { data, error } = menuRes
      if (error) throw error
      const rows = (data ?? []) as MenuRpcRow[]
      // A failed gap read is NOT an empty gap list: serving "no gaps" because
      // the query broke would assert continuity we did not check. It throws
      // into the same fallback the menu aggregate uses.
      if (coinGapsRes.error) throw coinGapsRes.error
      const gapRows = (coinGapsRes.data ?? []) as GapRpcRow[]
      const gapsFor = new Map<string, SeriesGap[]>()
      for (const g of gapRows) {
        const from = Date.parse(g.gap_from)
        const to = Date.parse(g.gap_to)
        const held = gapsFor.get(g.coin) ?? []
        held.push({
          from,
          to,
          duration_ms: to - from,
          coin: g.coin,
          unexplained_coins: Number(g.unexplained_coins),
          kind: 'position_break',
        })
        gapsFor.set(g.coin, held)
      }
      const coins: CoinMenuEntry[] = rows.map(r => ({
        coin: r.coin,
        fills: Number(r.fill_count),
        from: Date.parse(r.first_fill),
        to: Date.parse(r.last_fill),
        realized_pnl: Number(r.realized_pnl),
        gaps: (gapsFor.get(r.coin) ?? []).sort((a, b) => a.from - b.from),
        spark: null,
      }))
      const allGaps = coins.flatMap(c => c.gaps)
      const fillCount = coins.reduce((s, c) => s + c.fills, 0)
      const from = coins.length ? Math.min(...coins.map(c => c.from)) : null
      const to = coins.length ? Math.max(...coins.map(c => c.to)) : null
      const coinsCapped = rows.length >= MENU_COIN_CAP
      return {
        coins,
        isCohort,
        wallet,
        gapCoins,
        coinsCapped,
        coverage: {
          source: 'store',
          from: from === null ? null : new Date(from).toISOString(),
          to: to === null ? null : new Date(to).toISOString(),
          fill_count: fillCount,
          capped: false,
          gaps: allGaps,
          contiguous: allGaps.length === 0,
          // The menu never holds the fills, so wallet-level measured time is
          // not computable here. Null says "unknown"; it must not be read as
          // the whole span.
          covered_ms: null,
          note: coins.length
            ? `AlphaLens capture store: ${fillCount.toLocaleString()} fills across ${coins.length} coin${coins.length === 1 ? '' : 's'}, ${fmtDay(from!)} to ${fmtDay(to!)}` +
              (coinsCapped ? ` (most-traded ${MENU_COIN_CAP} coins listed; more exist)` : '') +
              (gapNote(allGaps) ? ` — ${gapNote(allGaps)}` : '')
            : 'AlphaLens capture store: no captured fills yet for this cohort wallet',
        },
      }
    } catch (err) {
      // Store unreachable: fall through to the exchange window, same rule as
      // the fills reader — the coverage block says which source answered,
      // and the reason is logged so a cohort wallet quietly serving its
      // shallow recent window is diagnosable.
      console.error(
        'coin-menu store read failed, falling back to exchange window:',
        err instanceof Error ? err.message : err
      )
    }
  }

  // For a cohort wallet this path is a DEGRADED read (the aggregate above
  // did not answer), and loadWalletFills labels it as such in its coverage
  // note — it repeats the store attempt and lands in the same fallback.
  const { fills, coverage, gapCoins: exchangeGaps } = await loadWalletFills(address, {
    wallet,
  })
  return {
    coins: entriesFromFills(fills),
    coverage,
    isCohort,
    wallet,
    gapCoins: isCohort ? gapCoins : exchangeGaps,
    coinsCapped: false,
  }
}
