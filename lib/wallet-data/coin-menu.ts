import { getSupabase } from '@/lib/db/supabase'
import {
  loadWalletRow,
  loadWalletFills,
  loadGapCoins,
  type FillsCoverage,
  type WalletRow,
} from './fills'
import type { Fill } from '@/lib/hyperliquid/types'

// The replay coin menu: per-coin trade counts, spans and realized PnL for a
// wallet, fast enough to be the page's first paint (Replay v2.2). Two paths,
// same rule as the fills reader:
//
// - Cohort wallets: ONE SQL aggregate (`replay_coin_menu`, migration 018)
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

/** RPC caps its result at this many coins; the loader declares when hit. */
const MENU_COIN_CAP = 200

/** Sparkline sample budget — cumulative realized PnL, at most this many points. */
const SPARK_POINTS = 24

export interface CoinMenuEntry {
  coin: string
  fills: number
  /** First/last fill in the covered window, ms. */
  from: number
  to: number
  /** Sum of exchange-reported realized PnL over the covered fills, USD. */
  realized_pnl: number
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
      spark: sparkOf(coinFills),
    }))
    .sort((a, b) => b.fills - a.fills)
}

export async function loadCoinMenu(address: string): Promise<CoinMenu> {
  const wallet = await loadWalletRow(address)
  const isCohort = Boolean(wallet?.capture_enabled)

  if (isCohort) {
    try {
      const supabase = getSupabase()
      const [{ data, error }, gapCoins] = await Promise.all([
        supabase.rpc('replay_coin_menu', { p_wallet: address.toLowerCase() }),
        loadGapCoins(address),
      ])
      if (error) throw error
      const rows = (data ?? []) as MenuRpcRow[]
      const coins: CoinMenuEntry[] = rows.map(r => ({
        coin: r.coin,
        fills: Number(r.fill_count),
        from: Date.parse(r.first_fill),
        to: Date.parse(r.last_fill),
        realized_pnl: Number(r.realized_pnl),
        spark: null,
      }))
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
          note: coins.length
            ? `AlphaLens capture store: ${fillCount.toLocaleString()} fills across ${coins.length} coin${coins.length === 1 ? '' : 's'}, ${fmtDay(from!)} to ${fmtDay(to!)}` +
              (coinsCapped ? ` (most-traded ${MENU_COIN_CAP} coins listed; more exist)` : '')
            : 'AlphaLens capture store: no captured fills yet for this cohort wallet',
        },
      }
    } catch {
      // Store unreachable: fall through to the exchange window, same rule as
      // the fills reader — the coverage block says which source answered.
    }
  }

  const { fills, coverage, isCohort: cohortNow, wallet: walletNow, gapCoins } =
    await loadWalletFills(address)
  return {
    coins: entriesFromFills(fills),
    coverage,
    isCohort: cohortNow,
    wallet: walletNow ?? wallet,
    gapCoins,
    coinsCapped: false,
  }
}
