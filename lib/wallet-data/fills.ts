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
/** Windowed (curated famous-episode) loads target a known window rather than
 *  "whatever is retained", so they get a deeper page budget. Bounded still:
 *  80K fills. Hitting it is declared as capped coverage, never silent. */
const HL_MAX_PAGES_WINDOWED = 40

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

/** One captured fill as `replay_wallet_fills_json` packs it, positionally:
 *  [asset, side, size, price, fee_usd, realized_pnl, trade_type,
 *   timestamp_ms, tid, start_position]. */
type StoreFillRow = [
  string,
  string,
  number,
  number,
  number | null,
  number | null,
  string | null,
  number,
  number,
  number | null,
]

function storeRowToFill(r: StoreFillRow): Fill {
  const [asset, side, size, price, fee, pnl, dir, timeMs, tid, start] = r
  return {
    coin: asset,
    px: String(price),
    sz: String(size),
    side: side === 'B' ? 'B' : 'A',
    time: Number(timeMs),
    startPosition: start === null ? 'NaN' : String(start),
    dir: dir ?? '',
    closedPnl: pnl === null ? '0' : String(pnl),
    hash: '',
    oid: 0,
    crossed: false,
    fee: fee === null ? '0' : String(fee),
    tid,
  }
}

/** A time window to load instead of the whole retained/captured history —
 *  used by curated famous-episode builds, whose episode is a known, closed
 *  span. Milliseconds since epoch, inclusive. */
export interface FillsWindow {
  fromMs: number
  toMs: number
}

/** Captured fills from our store, ascending by (timestamp, tid). Only rows
 *  the capture daemon wrote (`tid is not null`).
 *
 *  ONE round trip, through `replay_wallet_fills_json` (migration 020). Three
 *  things were measured on the way here, and all three are load-bearing:
 *
 *  - PostgREST truncates at ~1,000 rows for RPCs exactly as it does for
 *    table reads (asked a set-returning function for 5,000/10,000/30,000
 *    rows, got 1,000 back every time, silently). So a 26,000-fill coin was
 *    27 HTTP round trips.
 *  - Those round trips WERE the cold path: the database answers a page in
 *    18-35 ms, but 27 of them cost ~13 s of the 16 s to first bar. Paging
 *    concurrently helped and was still the wrong shape.
 *  - The 1,000 cap counts ROWS, so a function returning a single jsonb row
 *    escapes it. The whole scope now arrives at once, as compact positional
 *    arrays with epoch-ms timestamps.
 *
 *  Reads never use a raw parameterized asset filter: Postgres' generic plan
 *  for "wallet = $1 AND asset = $2" can drive from the (asset, timestamp)
 *  index — the whole asset, every wallet — and hit statement_timeout on a
 *  popular coin. The RPC's coin guard is structurally unservable by that
 *  index, so every plan drives from the wallet index (migration 019).
 *
 *  Truncation is declared, never inferred: the RPC returns the exact `total`
 *  alongside the rows it served, and when the cap bites the rows served are
 *  the most RECENT ones. */
async function loadStoreFills(
  address: string,
  coin?: string,
  onPage?: (fillsSoFar: number) => void,
  window?: FillsWindow
): Promise<{ fills: Fill[]; capped: boolean }> {
  const supabase = getSupabase()
  // A curated famous episode is a FIXED window in the past, so it is read by
  // time, not by recency: the recency-capped reader keeps the most recent
  // rows, and an actively trading wallet would carry the pinned episode out
  // of that slice (measured: xyz:MU at 14,025 fills, ~4,600/day, against the
  // 20,000 cap). Migration 022 mirrors 021 exactly but bounds by window.
  const { data, error } = window
    ? await supabase.rpc('replay_wallet_fills_window_json', {
        p_wallet: address.toLowerCase(),
        p_coin: coin ?? '',
        p_from_ms: Math.floor(window.fromMs),
        p_to_ms: Math.ceil(window.toMs),
        p_limit: STORE_MAX_FILLS,
      })
    : await supabase.rpc('replay_wallet_fills_json', {
        p_wallet: address.toLowerCase(),
        p_coin: coin ?? '',
        p_limit: STORE_MAX_FILLS,
      })
  if (error) throw error
  const payload = (data ?? { total: 0, n: 0, rows: [] }) as {
    total: number
    n: number
    rows: StoreFillRow[]
  }
  const rows = payload.rows ?? []
  onPage?.(rows.length)
  return {
    fills: rows.map(storeRowToFill),
    capped: Number(payload.total) > rows.length,
  }
}

/** POST to the exchange info API. A failed request THROWS — it must never
 *  yield null that a caller could mistake for "no fills": an empty array
 *  dressed as no trades is the exact dishonesty this module's contract
 *  forbids (a rate-limited build once cached an empty doc this way).
 *  Rate limits (429) and transient 5xx get two bounded retries. */
async function hlPost<T>(payload: Record<string, unknown>): Promise<T> {
  const delays = [2_000, 8_000]
  for (let attempt = 0; ; attempt++) {
    let status = 0
    try {
      const res = await fetch(HL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
      })
      if (res.ok) return (await res.json()) as T
      status = res.status
      if (attempt >= delays.length || (status < 500 && status !== 429)) {
        throw new Error(`Hyperliquid info API answered ${status}`)
      }
    } catch (err) {
      const transient = status === 429 || status >= 500 || status === 0
      if (attempt >= delays.length || !transient) {
        throw err instanceof Error ? err : new Error('Hyperliquid info API unreachable')
      }
    }
    await new Promise(r => setTimeout(r, delays[attempt]))
  }
}

/**
 * Walk userFillsByTime forward until a short page (from the epoch by default;
 * from a curated window's start when one is given).
 *
 * The cursor advances TO the last fill's timestamp, not past it: during a
 * liquidation cascade thousands of fills share the same millisecond, and a
 * page boundary landing inside such a burst silently drops the same-ms fills
 * a `last.time + 1` cursor would skip. Measured on a real cascade: the +1
 * walk lost 756 of 13,829 fills — about $3.5M of realized PnL misreported.
 * Re-fetching the boundary millisecond and deduplicating by tid loses
 * nothing; the cursor moves past it only when a page adds no new fills.
 */
async function loadExchangeFills(
  address: string,
  onPage?: (fillsSoFar: number) => void,
  window?: FillsWindow
): Promise<{ fills: Fill[]; capped: boolean }> {
  const byTid = new Map<number, Fill>()
  let startTime = window ? window.fromMs : 1
  const maxPages = window ? HL_MAX_PAGES_WINDOWED : HL_MAX_PAGES
  let page = 0
  for (; page < maxPages; page++) {
    const payload: Record<string, unknown> = { type: 'userFillsByTime', user: address, startTime }
    if (window) payload.endTime = window.toMs
    const batch = await hlPost<Fill[]>(payload)
    if (!Array.isArray(batch) || batch.length === 0) break
    const before = byTid.size
    for (const f of batch) byTid.set(f.tid, f)
    onPage?.(byTid.size)
    if (batch.length < HL_PAGE) break
    const last = batch[batch.length - 1].time
    startTime = byTid.size > before ? last : last + 1
  }
  return {
    fills: [...byTid.values()].sort((a, b) => a.time - b.time),
    capped: page >= maxPages,
  }
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
  opts: {
    coin?: string
    onPage?: (fillsSoFar: number) => void
    /** The wallets row when the caller already read it (the doc route reads
     *  it to decide cohort freshness). Saves a second identical round trip
     *  in the request path; `null` means "known absent", not "unknown". */
    wallet?: WalletRow | null
    /** Load only this window (curated famous-episode builds). The coverage
     *  note names the scope so a windowed doc never reads as full history. */
    window?: FillsWindow
    /** Override the source rule. Only curated famous episodes set this, and
     *  only to 'exchange': a capture_enabled wallet whose curated episode
     *  predates its captured range would otherwise read the store and find
     *  nothing there — an absence of capture rendered as an absence of
     *  trading. The entry's coverage note states why. `isCohort` below still
     *  reports what the wallet IS, not which tape answered. */
    forceSource?: 'store' | 'exchange'
  } = {}
): Promise<WalletFills> {
  const wallet = opts.wallet !== undefined ? opts.wallet : await loadWalletRow(address)
  const isCohort = Boolean(wallet?.capture_enabled)
  /** A cohort wallet that had to fall back to the exchange — its captured
   *  history exists but could not be read. Declared, never quietly served. */
  let degraded = false

  if (isCohort && opts.forceSource !== 'exchange') {
    try {
      const [{ fills, capped }, gapCoins] = await Promise.all([
        loadStoreFills(address, opts.coin, opts.onPage, opts.window),
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
            ? `AlphaLens capture store${opts.window ? ' (curated episode window)' : ''}: ${fills.length.toLocaleString()} fills, ${fmtDay(fills[0].time)} to ${fmtDay(fills[fills.length - 1].time)}` +
              (capped ? ` (most recent ${STORE_MAX_FILLS.toLocaleString()} served; older captured fills exist)` : '')
            : 'AlphaLens capture store: no captured fills yet for this cohort wallet',
        },
      }
    } catch (err) {
      // Store unreachable: fall through to the exchange window rather than
      // failing the page — but say so. This wallet HAS captured history
      // deeper than the exchange's window, and serving that shallow window
      // unremarked would present a degraded read as a complete one.
      degraded = true
      console.error(
        'store fills read failed, falling back to exchange window:',
        err instanceof Error ? err.message : err
      )
    }
  }

  const { fills: all, capped } = await loadExchangeFills(address, opts.onPage, opts.window)
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
      capped,
      note:
        (fills.length
          ? (opts.window
              ? `Exchange fills over the curated episode window: ${fills.length.toLocaleString()} fills, ${fmtDay(fills[0].time)} to ${fmtDay(fills[fills.length - 1].time)}`
              : `Recent window only (older fills age out of the API): ${fills.length.toLocaleString()} fills, ${fmtDay(fills[0].time)} to ${fmtDay(fills[fills.length - 1].time)}`)
          : 'No fills in the exchange-served window (older fills age out of the API)') +
        (capped ? ' (page budget reached; the window may hold more fills than served)' : '') +
        (degraded
          ? ' — our capture store did not answer for this cohort wallet, so its deeper captured history is NOT included here'
          : ''),
    },
  }
}
