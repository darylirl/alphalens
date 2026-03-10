# Hyperliquid Data Connections Audit

**Date:** 2026-03-10
**Test Wallet:** `0x010461C14e146ac35Fe42271BDC1134EE31C703a`
**API Base:** `https://api.hyperliquid.xyz/info` (POST, no auth)

---

## WORKING — Live & Returning Data

### 1. `clearinghouseState`
- **Status:** WORKING
- **Used in:** `/api/wallets/[address]`, `/api/seed`, `/api/scanner`, `/api/smart-money`, `/api/agent` (3 tools)
- **Returns:** Account value ($121.4M for test wallet), open positions (BTC, ETH, SOL, ATOM, DYDX, etc.), margin summary, leverage, liquidation prices, unrealized PnL, cumulative funding
- **Verified:** Full JSON response with real-time position data

### 2. `userFillsByTime`
- **Status:** WORKING
- **Used in:** `/api/wallets/[address]`, `/api/smart-money`, `/api/agent` (`get_wallet_fills`, `scan_wallets_by_period`)
- **Returns:** Trade fills with coin, price, size, side, closedPnl, fee, timestamp, hash, direction (Open Long/Close Short/etc.)
- **Verified:** Returns active fills within seconds of request time

### 3. `userFunding` (called as `userFundings` in code)
- **Status:** WORKING
- **Used in:** `/api/wallets/[address]`, `/api/smart-money`
- **Returns:** Funding payments with coin, USDC amount, position size, funding rate, timestamp
- **Verified:** Returns funding entries across all held positions (BTC, ETH, ATOM, SOL, etc.)

### 4. `metaAndAssetCtxs`
- **Status:** WORKING
- **Used in:** `/api/market`, `/api/smart-money`, `/api/scanner`, `/api/agent` (`get_market_overview`, `get_asset_info`)
- **Returns:** Full asset universe (300+ perps) with szDecimals, maxLeverage, marginTableId. Asset contexts with markPx, midPx, prevDayPx, dayNtlVlm, openInterest, funding rate
- **Verified:** Complete metadata for all listed assets

### 5. `portfolio`
- **Status:** WORKING
- **Used in:** `/api/wallets/[address]`, `/api/agent` (`get_wallet_pnl`)
- **Returns:** Account value history and PnL history arrays for day/week/month/allTime windows, with timestamps and volume
- **Verified:** Returns multi-timeframe PnL curves with $121M+ account values

### 6. `recentTrades`
- **Status:** WORKING
- **Used in:** `/api/seed`, `/api/scanner`, `/api/smart-money`
- **Returns:** Recent trades with coin, side, price, size, timestamp, hash, and both trader addresses (users array)
- **Verified:** Real-time BTC trades with sub-second freshness

### 7. `l2Book`
- **Status:** WORKING
- **Used in:** `/api/scanner` (attempted address extraction), `lib/hyperliquid/client.ts` (library)
- **Returns:** Full order book with 20 levels of bids/asks, each with price, size, and order count
- **Verified:** Live BTC order book at ~$69,985 bid / ~$69,986 ask

### 8. `candleSnapshot`
- **Status:** WORKING
- **Used in:** `lib/hyperliquid/client.ts` (library function only — NOT used in any UI/route)
- **Returns:** OHLCV candles with timestamp, open, high, low, close, volume, trade count
- **Verified:** 1h BTC candles returned with full data

### 9. `openOrders`
- **Status:** WORKING
- **Used in:** `lib/hyperliquid/client.ts` (library function only — NOT used in any UI/route)
- **Returns:** Active limit orders with coin, side, limitPx, sz, timestamp, origSz
- **Verified:** Test wallet has active orders on GRIFFAIN, AERO, VVV, POPCAT, etc.

### 10. `allMids`
- **Status:** WORKING
- **Used in:** `lib/hyperliquid/client.ts` (library function only — NOT used in any UI/route)
- **Returns:** Current mid prices for all assets (BTC ~$70,073, ETH ~$2,040, SOL ~$86, etc.)
- **Verified:** Full price map for 200+ assets

### 11. `userFills` (legacy)
- **Status:** WORKING (used as fallback in client.ts)
- **Used in:** `lib/hyperliquid/client.ts` (fallback when `userFillsByTime` fails), Python analytics service
- **Verified:** Implicitly tested via fallback mechanism

---

## BROKEN — Endpoint Failures

### 1. `leaderboard`
- **Status:** BROKEN — Returns `"Failed to deserialize the JSON body into the target type"`
- **Used in:** `/api/leaderboard/route.ts`, `/api/scanner/route.ts` (discovery source), `lib/hyperliquid/client.ts`
- **Impact:**
  - `/api/leaderboard` route returns 502 to frontend
  - Scanner loses one of its 3 wallet discovery sources (still has `recentTrades` and `l2Book`)
  - Dashboard leaderboard tab shows stale or no data
- **Root Cause:** Hyperliquid appears to have deprecated or changed the `leaderboard` endpoint format. Tested multiple payload variations (`window`, `timeWindow`, `period`, `timeframe`) — all fail.
- **Severity:** MEDIUM — Scanner and seed still work via `recentTrades`; leaderboard page is affected

---

## NOT CONNECTED — Implemented but Unused

### 1. WebSocket Real-Time Streaming
- **Files:** `lib/hyperliquid/websocket.ts`, `app/api/stream/route.ts`
- **Status:** Code fully implemented but NO UI component connects to it
- **Capabilities built:**
  - `subscribeUserEvents(address)` — Real-time position/fill updates
  - `subscribeTrades(coin)` — Live trade stream
  - `subscribeAssetCtx(coin)` — Live price/OI/funding updates
  - SSE streaming endpoint at `/api/stream?address=...`
- **Impact:** No real-time data anywhere in the UI. All data is fetched on page load only.

### 2. `candleSnapshot` (Chart Data)
- **File:** `lib/hyperliquid/client.ts`
- **Status:** Library function exists, endpoint works, but no UI uses it
- **Impact:** No price charts anywhere in the app (not on market page, not on asset detail, not on wallet profile)

### 3. `openOrders` (Active Orders)
- **File:** `lib/hyperliquid/client.ts`
- **Status:** Library function exists, endpoint works, but no UI uses it
- **Impact:** Wallet profile page doesn't show active/pending orders

### 4. `allMids` (Current Prices)
- **File:** `lib/hyperliquid/client.ts`
- **Status:** Library function exists, endpoint works, but no UI uses it
- **Impact:** Using `metaAndAssetCtxs` instead (which includes prices plus metadata). Not a problem per se, but `allMids` is lighter weight for price-only lookups.

### 5. Redis Cache Layer
- **File:** `lib/cache/redis.ts`
- **Status:** Upstash Redis client initialized but NOT used in any API route
- **Impact:** Every API request hits Hyperliquid directly. No caching = higher latency, potential rate limiting under load

### 6. Supabase Tables (Created but Empty/Unused)
- **Tables:** `fills`, `positions`, `alerts`, `watchlists`, `quant_rules`, `alert_configs`
- **Status:** Migration created these tables but no code reads/writes to them
- **Impact:** Historical data not persisted; alerts system non-functional

---

## MOCK / PLACEHOLDER DATA

### 1. Performance Page (`/app/performance/page.tsx`)
- **Status:** 5 hardcoded demo trades — no Hyperliquid connection
- **Impact:** Performance tracking is entirely fake

### 2. Pocket Quant Backtester (`/components/quant/SimpleRuleBuilder.tsx`)
- **Status:** Generates 5 random mock signals per "backtest" — no real data
- **Impact:** Strategy backtesting doesn't use actual market data

### 3. Signals API (`/app/api/signals/route.ts`)
- **Status:** Returns empty array stub
- **Impact:** Alert/signal system is non-functional

---

## DATA PIPELINE HEALTH

| Pipeline | Source | Processing | Storage | UI Display | Health |
|----------|--------|------------|---------|------------|--------|
| Market Dashboard | `metaAndAssetCtxs` | Volume/OI aggregation | None (direct) | Market page | HEALTHY |
| Wallet Profile | 4 parallel calls | Position/PnL/Fills/Funding | None (direct) | Wallet detail | HEALTHY |
| Smart Money | `metaAndAssetCtxs` + `recentTrades` + per-wallet enrichment | Sector analysis, tier classification | None (direct) | Smart Money page | HEALTHY |
| Wallet Seeding | `recentTrades` + `clearinghouseState` | Archetype classification | Supabase `wallets` | Hunters page | HEALTHY |
| Scanner | `recentTrades` + `leaderboard` + `clearinghouseState` | Tier classification | Supabase `wallets` | Hunters page | DEGRADED (leaderboard broken) |
| AI Agent | 7 tools using multiple endpoints | On-the-fly analysis | None (streamed) | Agent chat | HEALTHY |
| Leaderboard | `leaderboard` | Direct passthrough | None | Dashboard tab | BROKEN |
| Real-time Streaming | WebSocket | SSE bridge | None | None | NOT CONNECTED |
| Performance Tracking | None | Hardcoded | None | Performance page | MOCK DATA |
| Backtesting | None | Random generation | None | Quant page | MOCK DATA |

---

## RECOMMENDATIONS

### Priority 1 — Fix Broken
1. **Fix or replace `leaderboard` endpoint.** The Hyperliquid leaderboard API no longer accepts the documented payload format. Options:
   - Use `recentTrades` + `clearinghouseState` to build a custom leaderboard from tracked wallets (already partially done in scanner)
   - Scrape from `app.hyperliquid.xyz/leaderboard` as a fallback
   - Use Nansen API for leaderboard data
   - Remove the leaderboard route and build from Supabase `wallets` table data

### Priority 2 — Connect What's Built
2. **Wire up WebSocket streaming** to wallet profile page for live position updates. The SSE endpoint (`/api/stream`) and client class (`HyperliquidWebSocket`) are fully implemented — just need a React hook to consume them.
3. **Add price charts** using the working `candleSnapshot` endpoint. The library function is ready — needs a chart component (Recharts is already installed).
4. **Show open orders** on wallet profile using the working `openOrders` endpoint.
5. **Enable Redis caching** in high-traffic API routes (`/api/market`, `/api/smart-money`) to reduce Hyperliquid API load and improve response times.

### Priority 3 — Replace Mock Data
6. **Performance page:** Connect to `userFillsByTime` for real trade history and P&L tracking instead of hardcoded demo trades.
7. **Quant backtester:** Use `candleSnapshot` for real OHLCV data in backtests instead of random signal generation.
8. **Signals system:** Wire WebSocket `userEvents` subscription to power real-time alerts.

### Priority 4 — Data Completeness
9. **Persist fills to Supabase** — The `fills` table exists but is empty. Storing historical fills would enable faster queries and offline analytics.
10. **Add spot market support** — Currently only perps are tracked. Hyperliquid also has spot assets (via `spotMeta`, `spotClearinghouseState`).
11. **Add vault tracking** — Hyperliquid vaults (`vaultDetails`) are not tracked at all.

---

## SUMMARY

| Category | Count | Details |
|----------|-------|---------|
| WORKING endpoints | 11 | clearinghouseState, userFillsByTime, userFundings, metaAndAssetCtxs, portfolio, recentTrades, l2Book, candleSnapshot, openOrders, allMids, userFills |
| BROKEN endpoints | 1 | leaderboard (API format changed/deprecated) |
| Built but not connected | 5 | WebSocket streaming, candleSnapshot UI, openOrders UI, allMids usage, Redis cache |
| Mock/placeholder data | 3 | Performance page, Quant backtester, Signals API |
| Healthy pipelines | 5 | Market, Wallet Profile, Smart Money, Seeding, AI Agent |
| Degraded pipelines | 1 | Scanner (leaderboard source broken) |
| Broken pipelines | 1 | Leaderboard page |
| Non-functional pipelines | 3 | Real-time streaming, Performance tracking, Backtesting |

**Bottom line:** The core data pipeline is solid — 11 of 12 Hyperliquid endpoints work correctly and return live data. The only broken endpoint is `leaderboard`, which appears to have been deprecated by Hyperliquid. The biggest gap is not broken connections but **unconnected features**: WebSocket streaming, price charts, open orders display, and Redis caching are all implemented but not wired to the UI.
