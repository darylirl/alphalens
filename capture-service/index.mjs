#!/usr/bin/env node
/**
 * AlphaLens forward-capture daemon (Prompt A0).
 *
 * Always-on service that captures out-of-sample market data for the
 * Verification Engine. Correctness beats features:
 *
 *  - WebSocket userFills subscriptions for a prioritized subset of tracked
 *    wallets (WS_WALLET_LIMIT; Hyperliquid caps subscriptions per IP, and the
 *    tracked table holds thousands of wallets).
 *  - A rotating REST poll sweep over ALL tracked wallets. This is the
 *    gap-detection path the spec asks for AND the lossless backstop: the
 *    fills endpoint retains a wallet's most recent ~2000 fills, so a sweep
 *    cycle shorter than "2000 fills of activity" misses nothing. It also
 *    heals WS outages on reconnect for free.
 *  - WS 1m candle subscriptions for every coin the tracked cohort trades,
 *    plus an hourly candleSnapshot sweep. 1m retention is ~3.5 days
 *    (measured), so any outage shorter than that self-heals.
 *  - Idempotent writes: fills upsert on (wallet_address, tid) with
 *    ignore-duplicates; candles upsert on (coin, t) with merge-duplicates
 *    (the in-progress bar updates until it closes; last write wins).
 *  - start_position is stored on every fill — the completeness ground truth.
 *    New wallets get a full forward-paginated backfill validated the same
 *    way as backtest_copy.py: a coin whose earliest retrievable fill has
 *    startPosition != 0 is recorded in capture_gaps so no replay engine
 *    ever fabricates entries for it.
 *  - Heartbeat row to capture_health every minute; Telegram alert if no
 *    successful write for 5+ minutes (re-alert every 15 minutes).
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY),
 *      TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (optional),
 *      WS_WALLET_LIMIT (default 300), SWEEP_WALLETS_PER_MIN (default 30).
 *
 * Run: node index.mjs   (Node >= 22; zero npm dependencies)
 */

const HL_REST = 'https://api.hyperliquid.xyz/info'
const HL_WS = 'wss://api.hyperliquid.xyz/ws'

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '')
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ''
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('SUPABASE_URL / SUPABASE_ANON_KEY required')
  process.exit(1)
}

const WS_WALLET_LIMIT = parseInt(process.env.WS_WALLET_LIMIT || '300', 10)
const SWEEP_WALLETS_PER_MIN = parseInt(process.env.SWEEP_WALLETS_PER_MIN || '30', 10)
const CANDLE_COIN_LIMIT = parseInt(process.env.CANDLE_COIN_LIMIT || '150', 10)
const HEARTBEAT_MS = 60_000
const STALL_ALERT_MS = 5 * 60_000
const STALL_REALERT_MS = 15 * 60_000
const WALLET_REFRESH_MS = 10 * 60_000
const CANDLE_SWEEP_MS = 60 * 60_000
const FLUSH_MS = 5_000
const REST_MIN_INTERVAL_MS = 800          // global throttle for HL REST
const BACKFILL_MAX_PAGES = 30             // initial per-wallet history cap

const log = (...a) => console.log(new Date().toISOString(), ...a)

// ── Counters / state ────────────────────────────────────────────────────────
const state = {
  wsConnected: false,
  fillsLastMin: 0,
  candlesLastMin: 0,
  walletsWs: 0,
  walletsPolled: 0,
  coinsTracked: 0,
  lastWriteOk: Date.now(),
  lastStallAlert: 0,
}

// ── Supabase REST ───────────────────────────────────────────────────────────
async function sb(path, { method = 'GET', body, prefer } = {}) {
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  }
  if (prefer) headers.Prefer = prefer
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`supabase ${method} ${path.split('?')[0]}: ${res.status} ${text.slice(0, 200)}`)
  }
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

// ── Hyperliquid REST (throttled, backoff) ───────────────────────────────────
let lastRest = 0
async function hl(bodyObj, retries = 4) {
  const wait = REST_MIN_INTERVAL_MS - (Date.now() - lastRest)
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  lastRest = Date.now()
  let delay = 2000
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(HL_REST, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyObj),
      })
      if (res.ok) return await res.json()
      if (attempt >= retries) return null
    } catch {
      if (attempt >= retries) return null
    }
    await new Promise(r => setTimeout(r, delay))
    delay *= 2
  }
}

// ── Telegram ────────────────────────────────────────────────────────────────
async function telegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chat = process.env.TELEGRAM_CHAT_ID
  if (!token || !chat) { log('ALERT (telegram unconfigured):', text); return }
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: `[alphalens-capture] ${text}` }),
    })
  } catch (e) { log('telegram send failed:', e.message) }
}

// ── Write buffers (batched, idempotent) ─────────────────────────────────────
const fillBuffer = new Map()      // key wallet:tid -> row
const candleBuffer = new Map()    // key coin:t -> row

function bufferFill(wallet, f) {
  if (f.tid == null) return
  fillBuffer.set(`${wallet}:${f.tid}`, {
    wallet_address: wallet.toLowerCase(),
    asset: f.coin,
    side: f.side,
    size: parseFloat(f.sz),
    price: parseFloat(f.px),
    fee_usd: parseFloat(f.fee || '0'),
    realized_pnl: parseFloat(f.closedPnl || '0'),
    trade_type: f.dir || null,
    timestamp: new Date(f.time).toISOString(),
    tid: f.tid,
    start_position: f.startPosition != null ? parseFloat(f.startPosition) : null,
  })
}

function bufferCandle(c) {
  // WS candle fields: t open ms, s coin, o/h/l/c/v strings
  const coin = c.s ?? c.coin
  const t = c.t
  if (!coin || t == null) return
  candleBuffer.set(`${coin}:${t}`, {
    coin,
    t: new Date(t).toISOString(),
    o: parseFloat(c.o), h: parseFloat(c.h), l: parseFloat(c.l),
    c: parseFloat(c.c), v: parseFloat(c.v || '0'),
  })
}

async function flushBuffers() {
  if (fillBuffer.size > 0) {
    const rows = [...fillBuffer.values()]
    fillBuffer.clear()
    try {
      for (let i = 0; i < rows.length; i += 500) {
        await sb('fills?on_conflict=wallet_address,tid', {
          method: 'POST', body: rows.slice(i, i + 500),
          prefer: 'resolution=ignore-duplicates,return=minimal',
        })
      }
      state.fillsLastMin += rows.length
      state.lastWriteOk = Date.now()
    } catch (e) {
      log('fill flush failed:', e.message)
      for (const r of rows) fillBuffer.set(`${r.wallet_address}:${r.tid}`, r)
    }
  }
  if (candleBuffer.size > 0) {
    const rows = [...candleBuffer.values()]
    candleBuffer.clear()
    try {
      for (let i = 0; i < rows.length; i += 500) {
        await sb('candles_1m?on_conflict=coin,t', {
          method: 'POST', body: rows.slice(i, i + 500),
          prefer: 'resolution=merge-duplicates,return=minimal',
        })
      }
      state.candlesLastMin += rows.length
      state.lastWriteOk = Date.now()
    } catch (e) {
      log('candle flush failed:', e.message)
      for (const r of rows) candleBuffer.set(`${r.coin}:${new Date(r.t).getTime()}`, r)
    }
  }
}

// ── Tracked wallets & coin universe ─────────────────────────────────────────
let allWallets = []          // every tracked wallet address (lowercase)
let wsWallets = []           // prioritized subset for WS subscriptions
let activeCoins = new Set()  // coins for candle capture

async function sbPageAll(pathQs, pageSize = 1000) {
  // PostgREST caps responses at ~1000 rows regardless of limit; page with
  // offset until a short page.
  const out = []
  for (let offset = 0; ; offset += pageSize) {
    const page = await sb(`${pathQs}&limit=${pageSize}&offset=${offset}`)
    if (!page || page.length === 0) break
    out.push(...page)
    if (page.length < pageSize) break
  }
  return out
}

async function refreshWallets() {
  try {
    // Classified wallets first (they are the analytically interesting set),
    // then everything else. removed_at filter tolerates the column's absence.
    const classified = await sbPageAll(
      'wallets?select=address&archetype=not.is.null&removed_at=is.null'
    ).catch(() => sbPageAll('wallets?select=address&archetype=not.is.null'))
    const rest = await sbPageAll('wallets?select=address&removed_at=is.null&order=address')
      .catch(() => sbPageAll('wallets?select=address&order=address'))
    const ordered = []
    const seen = new Set()
    for (const w of [...(classified || []), ...(rest || [])]) {
      const a = w.address.toLowerCase()
      if (!seen.has(a)) { seen.add(a); ordered.push(a) }
    }
    allWallets = ordered
    const nextWs = ordered.slice(0, WS_WALLET_LIMIT)
    state.walletsPolled = allWallets.length
    if (JSON.stringify(nextWs) !== JSON.stringify(wsWallets)) {
      wsWallets = nextWs
      resubscribe()
    }
  } catch (e) { log('wallet refresh failed:', e.message) }
}

async function refreshCoins() {
  try {
    const rows = await sb(
      `fills?select=asset&timestamp=gte.${new Date(Date.now() - 7 * 86_400_000).toISOString()}&limit=10000`
    )
    const counts = new Map()
    for (const r of rows || []) counts.set(r.asset, (counts.get(r.asset) || 0) + 1)
    const coins = [...counts.entries()].sort((a, b) => b[1] - a[1])
      .slice(0, CANDLE_COIN_LIMIT).map(([c]) => c)
    const next = new Set(coins)
    const changed = next.size !== activeCoins.size || [...next].some(c => !activeCoins.has(c))
    activeCoins = next
    state.coinsTracked = activeCoins.size
    if (changed) resubscribe()
  } catch (e) { log('coin refresh failed:', e.message) }
}

// ── WebSocket ───────────────────────────────────────────────────────────────
let ws = null
let wsBackoff = 1000
let pingTimer = null

function wsSend(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj))
}

function resubscribe() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  state.walletsWs = wsWallets.length
  for (const w of wsWallets) {
    wsSend({ method: 'subscribe', subscription: { type: 'userFills', user: w } })
  }
  for (const coin of activeCoins) {
    wsSend({ method: 'subscribe', subscription: { type: 'candle', coin, interval: '1m' } })
  }
  log(`subscribed: ${wsWallets.length} wallets, ${activeCoins.size} candle coins`)
}

function connectWs() {
  log('ws connecting…')
  ws = new WebSocket(HL_WS)

  ws.onopen = () => {
    log('ws connected')
    state.wsConnected = true
    wsBackoff = 1000
    resubscribe()
    clearInterval(pingTimer)
    pingTimer = setInterval(() => wsSend({ method: 'ping' }), 45_000)
    // WS reconnect gap-heal: sweep the WS wallet set promptly so anything
    // missed while disconnected is recovered via REST diff.
    prioritySweep = [...wsWallets]
  }

  ws.onmessage = (ev) => {
    let msg
    try { msg = JSON.parse(ev.data) } catch { return }
    if (msg.channel === 'userFills' && msg.data?.fills) {
      const user = (msg.data.user || '').toLowerCase()
      for (const f of msg.data.fills) bufferFill(user, f)
    } else if (msg.channel === 'candle' && msg.data) {
      bufferCandle(msg.data)
    }
  }

  ws.onclose = () => {
    state.wsConnected = false
    clearInterval(pingTimer)
    log(`ws closed; reconnect in ${wsBackoff}ms`)
    setTimeout(connectWs, wsBackoff)
    wsBackoff = Math.min(wsBackoff * 2, 60_000)
  }

  ws.onerror = () => { try { ws.close() } catch {} }
}

// ── Poll sweep (gap detection + lossless backstop for ALL wallets) ──────────
let sweepQueue = []
let prioritySweep = []
const backfilledThisRun = new Set()

async function cursorFor(wallet) {
  const rows = await sb(
    `fills?select=timestamp&wallet_address=eq.${wallet}&order=timestamp.desc&limit=1`
  )
  return rows && rows.length ? new Date(rows[0].timestamp).getTime() : null
}

async function initialBackfill(wallet) {
  // Full forward-paginated history with the backtest_copy.py completeness
  // check; truncated coins are recorded in capture_gaps.
  let start = 1
  const all = []
  const seen = new Set()
  for (let page = 0; page < BACKFILL_MAX_PAGES; page++) {
    const batch = await hl({ type: 'userFillsByTime', user: wallet, startTime: start })
    if (!Array.isArray(batch) || batch.length === 0) break
    for (const f of batch) if (!seen.has(f.tid)) { seen.add(f.tid); all.push(f) }
    if (batch.length < 2000) break
    start = Math.max(...batch.map(f => f.time)) + 1
  }
  if (all.length === 0) return 0
  all.sort((a, b) => a.time - b.time)

  const firstByCoin = new Map()
  for (const f of all) if (!firstByCoin.has(f.coin)) firstByCoin.set(f.coin, f)
  const gaps = []
  for (const [coin, f] of firstByCoin) {
    const sp = parseFloat(f.startPosition ?? '0')
    if (Math.abs(sp) > 1e-9) {
      gaps.push({ wallet_address: wallet, coin, first_start_position: sp })
    }
  }
  if (gaps.length > 0) {
    await sb('capture_gaps?on_conflict=wallet_address,coin', {
      method: 'POST', body: gaps,
      prefer: 'resolution=ignore-duplicates,return=minimal',
    }).catch(e => log('capture_gaps write failed:', e.message))
  }
  for (const f of all) bufferFill(wallet, f)
  return all.length
}

async function sweepOneWallet(wallet) {
  try {
    const cursor = await cursorFor(wallet)
    if (cursor === null) {
      if (!backfilledThisRun.has(wallet)) {
        backfilledThisRun.add(wallet)
        const n = await initialBackfill(wallet)
        if (n > 0) log(`backfilled ${wallet.slice(0, 10)}…: ${n} fills`)
      }
      return
    }
    // Overlap 60s behind the cursor; tid dedupe makes the overlap harmless.
    const fills = await hl({ type: 'userFillsByTime', user: wallet, startTime: cursor - 60_000 })
    if (Array.isArray(fills)) {
      for (const f of fills) bufferFill(wallet, f)
    }
  } catch (e) { log(`sweep ${wallet.slice(0, 10)}… failed:`, e.message) }
}

async function sweepTick() {
  for (let i = 0; i < SWEEP_WALLETS_PER_MIN; i++) {
    const wallet = prioritySweep.shift() ?? sweepQueue.shift()
    if (!wallet) {
      sweepQueue = [...allWallets]
      return
    }
    await sweepOneWallet(wallet)
  }
}

// ── Candle snapshot sweep (heals WS gaps; 1m retention is ~3.5d) ────────────
async function candleSweep() {
  for (const coin of activeCoins) {
    try {
      const rows = await sb(
        `candles_1m?select=t&coin=eq.${encodeURIComponent(coin)}&order=t.desc&limit=1`
      )
      const since = rows && rows.length
        ? new Date(rows[0].t).getTime() - 5 * 60_000
        : Date.now() - 6 * 3600_000
      const candles = await hl({
        type: 'candleSnapshot',
        req: { coin, interval: '1m', startTime: since, endTime: Date.now() },
      })
      if (Array.isArray(candles)) {
        for (const c of candles) bufferCandle({ ...c, s: coin })
      }
    } catch (e) { log(`candle sweep ${coin} failed:`, e.message) }
  }
  log(`candle sweep complete for ${activeCoins.size} coins`)
}

// ── Heartbeat & stall watchdog ──────────────────────────────────────────────
async function heartbeat() {
  const row = {
    service: 'capture',
    ws_connected: state.wsConnected,
    fills_written_1m: state.fillsLastMin,
    candles_written_1m: state.candlesLastMin,
    wallets_ws: state.walletsWs,
    wallets_polled: state.walletsPolled,
    coins_tracked: state.coinsTracked,
  }
  state.fillsLastMin = 0
  state.candlesLastMin = 0
  try {
    await sb('capture_health', { method: 'POST', body: [row], prefer: 'return=minimal' })
    state.lastWriteOk = Date.now()
  } catch (e) { log('heartbeat failed:', e.message) }

  const stalled = Date.now() - state.lastWriteOk
  if (stalled > STALL_ALERT_MS && Date.now() - state.lastStallAlert > STALL_REALERT_MS) {
    state.lastStallAlert = Date.now()
    await telegram(`capture stalled: no successful write for ${Math.round(stalled / 60000)}m (ws_connected=${state.wsConnected})`)
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  log(`capture daemon starting: ws_limit=${WS_WALLET_LIMIT}, sweep=${SWEEP_WALLETS_PER_MIN}/min`)
  await refreshWallets()
  await refreshCoins()
  connectWs()

  setInterval(flushBuffers, FLUSH_MS)
  setInterval(heartbeat, HEARTBEAT_MS)
  setInterval(refreshWallets, WALLET_REFRESH_MS)
  setInterval(refreshCoins, WALLET_REFRESH_MS)
  setInterval(candleSweep, CANDLE_SWEEP_MS)
  candleSweep()

  // Sweep loop: paced batches, one batch per minute.
  const sweepLoop = async () => {
    try { await sweepTick() } catch (e) { log('sweep tick failed:', e.message) }
    setTimeout(sweepLoop, 60_000)
  }
  sweepLoop()
}

process.on('unhandledRejection', (e) => log('unhandledRejection:', e?.message || e))
main()
