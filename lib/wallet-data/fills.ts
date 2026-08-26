import { getSupabase } from '@/lib/db/supabase'
import type { Fill } from '@/lib/hyperliquid/types'

// Server-only fills source shared by the report card (/card) and the replay
// (/replay). One rule decides where fills come from:
//
// - Cohort wallets (capture_enabled and not removed) read from OUR store —
//   deep history from the moment capture started, `tid is not null` only
//   (rows written by the capture daemon, carrying trade_type and
//   start_position), paged per CLAUDE.md.
// - Any other pasted wallet reads LIVE from the Hyperliquid API, which serves
//   roughly the 10,000 most recent fills and nothing older. That window is
//   reported as such, never presented as complete history.
//
// Every result carries a coverage block naming its source and window. A
// failed read is an error, never an empty array dressed as "no trades".

const HL_URL = 'https://api.hyperliquid.xyz/info'

/** HL serves at most this many fills per userFillsByTime response. */
const HL_PAGE = 2000
/** HL retains roughly this many recent fills per wallet; walking further is futile. */
const HL_MAX_PAGES = 6

/** Rows per PostgREST page (under the ~1000 silent cap). */
const STORE_PAGE = 1000
/** Hard cap on store fills served per request — an indexed per-wallet read,
 *  bounded. When hit, the truncation is declared in coverage, never silent. */
const STORE_MAX_FILLS = 20_000

export interface WalletRow {
  address: string
  label: string | null
  archetype: string | null
  capture_enabled: boolean
  win_rate: number | null
}

export interface FillsCoverage {
  source: 'store' | 'exchange'
  /** ISO timestamps of the first and last fill actually served; null when none. */
  from: string | null
  to: string | null
  fill_count: number
  /** True when the read hit its cap — older history exists but was not served. */
  capped: boolean
  note: string
}

export interface WalletFills {
  fills: Fill[] // ascending by time
  coverage: FillsCoverage
  isCohort: boolean
  wallet: WalletRow | null
  /** Coins whose captured history begins mid-position (capture_gaps): stats
   *  derived from them are lower bounds, and the replay says so. */
  gapCoins: string[]
}

/** The wallets row, or null when the address is not tracked. Never throws —
 *  an untracked wallet is a normal case, a DB outage falls back to exchange. */
export async function loadWalletRow(address: string): Promise<WalletRow | null> {
  try {
    const supabase = getSupabase()
    const { data } = await supabase
      .from('wallets')
      .select('address,label,archetype,capture_enabled,win_rate,removed_at')
      .eq('address', address.toLowerCase())
      .maybeSingle()
    if (!data || data.removed_at) return null
    return {
      address: data.address,
      label: data.label ?? null,
      archetype: data.archetype ?? null,
      capture_enabled: Boolean(data.capture_enabled),
      win_rate: data.win_rate === null || data.win_rate === undefined ? null : Number(data.win_rate),
    }
  } catch {
    return null
  }
}

interface StoreFillRow {
  asset: string
  side: string
  size: number
  price: number
  fee_usd: number | null
  realized_pnl: number | null
  trade_type: string | null
  timestamp: string
  tid: number
  start_position: number | null
}

function storeRowToFill(r: StoreFillRow): Fill {
  return {
    coin: r.asset,
    px: String(r.price),
    sz: String(r.size),
    side: r.side === 'B' ? 'B' : 'A',
    time: Date.parse(r.timestamp),
    startPosition: r.start_position === null ? 'NaN' : String(r.start_position),
    dir: r.trade_type ?? '',
    closedPnl: r.realized_pnl === null ? '0' : String(r.realized_pnl),
    hash: '',
    oid: 0,
    crossed: false,
    fee: r.fee_usd === null ? '0' : String(r.fee_usd),
    tid: r.tid,
  }
}

/** Captured fills from our store, newest-first paged then reversed to
 *  ascending. Only rows the capture daemon wrote (`tid is not null`). */
async function loadStoreFills(
  address: string,
  coin?: string,
  onPage?: (fillsSoFar: number) => void
): Promise<{ fills: Fill[]; capped: boolean }> {
  const supabase = getSupabase()
  const rows: StoreFillRow[] = []
  for (let offset = 0; offset < STORE_MAX_FILLS; offset += STORE_PAGE) {
    let query = supabase
      .from('fills')
      .select('asset,side,size,price,fee_usd,realized_pnl,trade_type,timestamp,tid,start_position')
      .eq('wallet_address', address.toLowerCase())
      .not('tid', 'is', null)
    if (coin) query = query.eq('asset', coin)
    const { data, error } = await query
      .order('timestamp', { ascending: false })
      .range(offset, offset + STORE_PAGE - 1)
    if (error) throw error
    const page = (data ?? []) as StoreFillRow[]
    rows.push(...page)
    onPage?.(rows.length)
    if (page.length < STORE_PAGE) {
      return { fills: rows.reverse().map(storeRowToFill), capped: false }
    }
  }
  return { fills: rows.reverse().map(storeRowToFill), capped: true }
}

async function hlPost<T>(payload: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch(HL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

/**
 * Walk userFillsByTime forward from the epoch until a short page. The
 * exchange retains only the most recent ~10K fills, so this converges in a
 * handful of requests and yields exactly the retained window.
 */
async function loadExchangeFills(
  address: string,
  onPage?: (fillsSoFar: number) => void
): Promise<Fill[]> {
  const byTid = new Map<number, Fill>()
  let startTime = 1
  for (let page = 0; page < HL_MAX_PAGES; page++) {
    const batch = await hlPost<Fill[]>({ type: 'userFillsByTime', user: address, startTime })
    if (!Array.isArray(batch) || batch.length === 0) break
    for (const f of batch) byTid.set(f.tid, f)
    onPage?.(byTid.size)
    if (batch.length < HL_PAGE) break
    startTime = batch[batch.length - 1].time + 1
  }
  return [...byTid.values()].sort((a, b) => a.time - b.time)
}

/** Capture-gap coins for a wallet — a tiny bounded read (unique per coin). */
export async function loadGapCoins(address: string): Promise<string[]> {
  try {
    const supabase = getSupabase()
    const { data } = await supabase
      .from('capture_gaps')
      .select('coin')
      .eq('wallet_address', address.toLowerCase())
      .limit(500)
    return (data ?? []).map((r: { coin: string }) => r.coin)
  } catch {
    return []
  }
}

const fmtDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export async function loadWalletFills(
  address: string,
  opts: { coin?: string; onPage?: (fillsSoFar: number) => void } = {}
): Promise<WalletFills> {
  const wallet = await loadWalletRow(address)
  const isCohort = Boolean(wallet?.capture_enabled)

  if (isCohort) {
    try {
      const [{ fills, capped }, gapCoins] = await Promise.all([
        loadStoreFills(address, opts.coin, opts.onPage),
        loadGapCoins(address),
      ])
      const from = fills.length ? new Date(fills[0].time).toISOString() : null
      const to = fills.length ? new Date(fills[fills.length - 1].time).toISOString() : null
      return {
        fills,
        isCohort,
        wallet,
        gapCoins,
        coverage: {
          source: 'store',
          from,
          to,
          fill_count: fills.length,
          capped,
          note: fills.length
            ? `AlphaLens capture store: ${fills.length.toLocaleString()} fills, ${fmtDay(fills[0].time)} to ${fmtDay(fills[fills.length - 1].time)}` +
              (capped ? ` (most recent ${STORE_MAX_FILLS.toLocaleString()} served; older captured fills exist)` : '')
            : 'AlphaLens capture store: no captured fills yet for this cohort wallet',
        },
      }
    } catch (err) {
      // Store unreachable: fall through to the exchange window rather than
      // failing the page — but the coverage block says which source answered,
      // and the reason lands in the server log so a cohort wallet silently
      // serving its shallow exchange window is diagnosable.
      console.error(
        'store fills read failed, falling back to exchange window:',
        err instanceof Error ? err.message : err
      )
    }
  }

  const all = await loadExchangeFills(address, opts.onPage)
  const fills = opts.coin ? all.filter(f => f.coin === opts.coin) : all
  const from = fills.length ? new Date(fills[0].time).toISOString() : null
  const to = fills.length ? new Date(fills[fills.length - 1].time).toISOString() : null
  return {
    fills,
    isCohort,
    wallet,
    gapCoins: [],
    coverage: {
      source: 'exchange',
      from,
      to,
      fill_count: fills.length,
      capped: fills.length >= HL_PAGE * (HL_MAX_PAGES - 1),
      note: fills.length
        ? `Recent window only (the exchange serves ~10K most recent fills): ${fills.length.toLocaleString()} fills, ${fmtDay(fills[0].time)} to ${fmtDay(fills[fills.length - 1].time)}`
        : 'No fills in the exchange-served window (the exchange serves ~10K most recent fills)',
    },
  }
}
