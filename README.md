# AlphaLens

**Hyperliquid Trader Intelligence Platform**

AlphaLens is a verification-first trading research platform built on the [Hyperliquid](https://hyperliquid.xyz) perpetuals DEX. It captures and classifies on-chain wallet activity, aggregates real cohort positioning (/pulse), and lets users backtest ideas with real frictions. Copy trading was deliberately removed after our own 28,318-trade replay showed it loses money — that verification engine is the core of the product.

**Live deployment:** [alphalens-taupe.vercel.app](https://alphalens-taupe.vercel.app)

---

## Table of Contents

- [Features](#features)
- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)
- [Pages & Routes](#pages--routes)
- [API Endpoints](#api-endpoints)
- [External API Integrations](#external-api-integrations)
- [Database Schema](#database-schema)
- [Analytics Engine](#analytics-engine)
- [Python Analytics Service](#python-analytics-service)
- [Wallet Connection](#wallet-connection)
- [State Management](#state-management)
- [Placeholder & Mock Data](#placeholder--mock-data)
- [Known Limitations & TODOs](#known-limitations--todos)
- [Deployment](#deployment)
- [Developer Notes](#developer-notes)

---

## Features

### What's Working Now

- **Wallet Discovery & Leaderboard** — Discovers wallets from recent Hyperliquid trades, computes analytics (Sharpe ratio, win rate, PnL, archetype), and displays a filterable leaderboard. Auto-seeds from the Hyperliquid API via a Vercel cron job every 6 hours.

- **Wallet Profile Pages** — Deep-dive into any wallet with three tabs:
  - **Overview** — Account value, open positions, position heatmap (treemap), cumulative PnL chart with 7D/30D/90D/All timeframes, token-level metrics, strategy summary, archetype classification, and alpha decay score.
  - **Trade History** — Paginated table of the last 90 days of trades with asset filter, sort toggle, side/PnL coloring, and fee column.
  - **Funding History** — Paginated table of all funding payments with position size, funding rate, USDC payment, and total funding summary.

- **Smart Money Flow** — Token-centric view showing institutional activity with confidence scores (0-10), equity tier breakdowns (Leviathan to Shrimp), sector analysis, long/short ratios, and per-wallet position details. All data is live from Hyperliquid.

- **Market Data Dashboard** — Live 24h volume, open interest, top gainers, and an interactive market heatmap sized by volume. Data pulled directly from Hyperliquid's `metaAndAssetCtxs` endpoint.

- **Wallet Archetype Classification** — Classifies wallets into 7 trading styles: Scalper, Swing Trader, Momentum Trader, High Conviction, Funding Arb, Farmer, Market Maker. Based on hold time, trade frequency, leverage patterns, and PnL distribution.

- **Copy Trading (RETIRED)** — removed after our own backtests (28,318 replayed trades with real frictions) showed naive copy-trading loses money. /copy-trade is a static explainer; /api/copy-trade returns 410 Gone. See the autopsy in /learn.

- **Pocket Quant (Strategy Builder)** — No-code rule builder with one-click strategy templates (Momentum Breakout, Mean Reversion, Trend Following). Includes a mock backtest engine. **Note:** The backtest produces simulated results, not real historical backtests.

- **Performance Tracking** — Real per-address Hyperliquid performance (fills + funding based) for a connected wallet. The disconnected state shows live capture-pipeline status from capture_health, never placeholder numbers.

- **Watchlists** — Client-side watchlist management (create lists, add/remove wallets). Stored in Zustand (browser memory, not persisted to database).

- **AI Agent** — Natural language interface powered by Claude (Anthropic API). Ask questions like "Find me 10 wallets that made 100% profit in the last 3 days" and the agent queries live Hyperliquid and Supabase data using tool calls to return formatted answers. Supports wallet search with filters, live position lookups, PnL history, trade fills, market overview, asset info, and **custom-timeframe return scanning** (scans ALL tracked wallets for any 1-90 day period). Model selector: **Haiku** (default, fast & affordable) or **Sonnet** (deeper analysis) via a drop-up menu. Wallet addresses in responses are clickable (link to wallet detail page) and copyable. Requires an `ANTHROPIC_API_KEY` environment variable.

- **Global Address Search** — Search bar in the Navbar allows looking up any Hyperliquid wallet address from any page. Validates the address format and navigates to the wallet detail page.

- **Copy Address Buttons** — All truncated wallet addresses across the platform (AI Agent, Dashboard, Explorer, Smart Money, Wallet Profile) have a copy-to-clipboard button and link to the wallet detail page.

- **Alerts UI** — Multi-tab alert center: Live Signals, Consensus Alerts, Alert Log, and Settings. Notification delivery scaffolding for Telegram and ntfy.sh is built but signals are currently empty (the WebSocket signal pipeline is not connected).

- **Learn/Education** — Static educational content explaining archetypes, equity tiers, smart money scoring, metrics glossary, and best practices.

### What's Placeholder / Not Yet Connected

See the [Placeholder & Mock Data](#placeholder--mock-data) and [Known Limitations](#known-limitations--todos) sections below.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Next.js 14)                     │
│  Landing ─ Dashboard ─ Explorer ─ Smart Money ─ Wallet Profile   │
│  AI Agent ─ Copy Trade ─ Pocket Quant ─ Performance ─ Alerts     │
├──────────────────────────────────────────────────────────────────┤
│                      API ROUTES (/app/api/)                      │
│  /market  /wallets  /hunters  /smart-money  /seed  /copy-trade   │
│  /agent  /signals  /quant/backtest  /quant/rules  /scanner       │
├──────────┬──────────┬──────────────┬──────────────┬──────────────┤
│Hyperliquid│ Supabase │ Anthropic    │ Upstash Redis│ Telegram /   │
│ REST API  │(Postgres)│ Claude API   │  (Caching)   │  ntfy.sh     │
└──────────┴──────────┴──────────────┴──────────────┴──────────────┘

┌──────────────────────────────────────────────────────────────────┐
│               ANALYTICS SERVICE (Python / FastAPI)                │
│  Scoring ─ Archetyping ─ Indicators ─ Ingestion Scheduler        │
│  (Standalone service — not deployed by default)                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Framework | **Next.js 14** (App Router) | Server & client rendering, API routes |
| Language | **TypeScript** (strict mode) | Type safety throughout |
| Styling | **Tailwind CSS 3** | Utility-first dark theme |
| Animations | **Framer Motion 11** | Page transitions, micro-interactions |
| Charts | **Recharts 2** | PnL charts, tooltips |
| State | **Zustand 4** | Client-side stores (watchlists, alerts, filters) |
| Database | **Supabase** (Postgres) | Wallet data, copy-trade configs |
| Caching | **Upstash Redis** | API response caching |
| Icons | **Lucide React** | Icon system |
| AI Agent | **Anthropic Claude API** (`@anthropic-ai/sdk`) | Natural language queries with tool use |
| Notifications | **Telegram Bot API**, **ntfy.sh** | Alert delivery |
| Deployment | **Vercel** / **Railway** | Hosting, serverless functions, cron |
| Analytics Service | **FastAPI + Python** | Standalone scoring/ingestion (optional) |

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- A Supabase project (free tier works)
- (Optional) Upstash Redis account
- (Optional) Telegram bot token
- (Optional) Anthropic API key (for AI Agent)

### Installation

```bash
git clone https://github.com/DarylLim/alphalens.git
cd alphalens
npm install
```

### Environment Setup

Create a `.env.local` file in the project root:

```env
# Required — Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key

# Optional — Caching (Upstash Redis)
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token

# Optional — Telegram Alerts
TELEGRAM_BOT_TOKEN=your-bot-token

# Optional — AI Agent (Claude)
ANTHROPIC_API_KEY=sk-ant-your-key

# Optional — Public app URL
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Database Setup

Run the migration in your Supabase SQL editor:

```sql
-- File: supabase/migrations/001_init.sql
-- Creates tables: wallets, fills, positions, alerts, watchlists, quant_rules, alert_configs
```

**Important:** Row-Level Security (RLS) must be disabled on the `wallets` table for the auto-seed endpoint to work. In Supabase Dashboard → Table Editor → `wallets` → disable RLS, or add a service-role key.

### Run Locally

```bash
npm run dev      # Starts on http://localhost:3000 (with Turbopack)
npm run build    # Production build
npm run start    # Start production server
npm run lint     # ESLint check
```

### Seed Wallets

On first launch, the leaderboard will be empty. Trigger the seed endpoint to discover wallets:

```bash
curl http://localhost:3000/api/seed
```

This fetches recent trades from 20 top Hyperliquid coins, discovers active wallets, computes analytics metrics, and inserts them into Supabase. The hunters page (`/hunters`) will also auto-trigger seeding if the wallet table is empty.

---

## Environment Variables

| Variable | Required | Used By | Purpose |
|----------|----------|---------|---------|
| `SUPABASE_URL` | Yes | `lib/db/supabase.ts` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | `lib/db/supabase.ts` | Supabase anonymous API key |
| `UPSTASH_REDIS_REST_URL` | No | `lib/cache/redis.ts` | Upstash Redis REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | No | `lib/cache/redis.ts` | Upstash Redis auth token |
| `TELEGRAM_BOT_TOKEN` | No | `lib/notifications/telegram.ts` | Telegram bot for alerts |
| `ANTHROPIC_API_KEY` | No | `app/api/agent/route.ts` | Claude API key for AI Agent |
| `NEXT_PUBLIC_APP_URL` | No | Client-side | Public-facing app URL |
| `CRON_SECRET` | No | `vercel.json` | Protects cron endpoint on Vercel |

---

## Project Structure

```
alphalens/
├── app/                          # Next.js App Router
│   ├── layout.tsx                # Root layout (WalletProvider + AppShell)
│   ├── page.tsx                  # Landing page
│   ├── dashboard/page.tsx        # Main dashboard
│   ├── hunters/page.tsx          # Wallet leaderboard (Explorer)
│   ├── smart-money/page.tsx      # Smart money flow analysis
│   ├── wallet/[address]/page.tsx # Individual wallet profile
│   ├── copy-trade/page.tsx       # Copy trading setup
│   ├── quant/page.tsx            # Pocket Quant strategy builder
│   ├── performance/page.tsx      # Performance attribution
│   ├── agent/page.tsx            # AI Agent chat interface
│   ├── alerts/page.tsx           # Alert center
│   ├── watchlist/page.tsx        # Watchlist management
│   ├── learn/page.tsx            # Educational content
│   └── api/                      # API routes (see below)
│
├── components/
│   ├── layout/                   # AppShell, Navbar, Sidebar, BottomNav
│   ├── agent/                    # AgentChat (AI assistant interface)
│   ├── wallet/                   # WalletProfile, PnLChart, PositionTable,
│   │                             # PositionHeatmap, TokenMetrics, StrategySummary,
│   │                             # TradeHistory, FundingHistory,
│   │                             # WalletCard, ArchetypeBadge, AlphaDecayMeter
│   ├── hunting/                  # HunterLeaderboard, FilterPanel, WalletScoreCard
│   ├── market/                   # MarketHeatmap
│   ├── signals/                  # ActiveSignalsFeed, ConsensusAlerts
│   ├── alerts/                   # AlertFeed, AlertConfig
│   ├── trade/                    # QuickTradeCard
│   ├── quant/                    # SimpleRuleBuilder, RuleBuilder,
│   │                             # OneClickStrategies, BacktestResult
│   ├── onboarding/               # OnboardingModal
│   └── ui/                       # CopyableAddress, EmptyState, MetricPill,
│                                 # PulseIndicator, SkeletonCard
│
├── lib/
│   ├── hyperliquid/
│   │   ├── client.ts             # Hyperliquid REST API client
│   │   ├── types.ts              # TypeScript interfaces for all API responses
│   │   └── websocket.ts          # WebSocket client (implemented, not actively used)
│   ├── analytics/
│   │   ├── pnl.ts                # PnL, Sharpe, win rate, max drawdown
│   │   ├── archetype.ts          # Wallet archetype classification
│   │   ├── alphaDecay.ts         # Alpha decay scoring
│   │   └── indicators.ts         # RSI, EMA, ATR technical indicators
│   ├── db/supabase.ts            # Supabase client (lazy-initialized via getSupabase())
│   ├── cache/redis.ts            # Upstash Redis client singleton
│   ├── notifications/
│   │   ├── telegram.ts           # Telegram alert delivery
│   │   └── ntfy.ts               # ntfy.sh push notifications
│   ├── wallet/WalletContext.tsx   # React Context for Web3 wallet connection
│   ├── store.ts                  # Zustand stores (watchlists, alerts, filters)
│   ├── walletAliases.ts          # Human-readable names for known wallets
│   └── validation.ts             # Input validation & sanitisation
│
├── analytics-service/            # Standalone Python analytics (see below)
│   ├── main.py                   # FastAPI entry point
│   ├── requirements.txt          # Python dependencies
│   ├── ingestion/                # Hyperliquid data ingestion + scheduler
│   └── analytics/                # Scoring, archetyping, indicators
│
├── supabase/
│   └── migrations/001_init.sql   # Database schema (7 tables)
│
├── public/
│   ├── logo.png                  # AlphaLens logo
│   └── favicon.png               # Favicon
│
├── tailwind.config.ts            # Theme: dark mode, custom colours, fonts
├── next.config.js                # Next.js configuration (minimal)
├── vercel.json                   # Vercel cron: /api/seed every 6 hours
├── tsconfig.json                 # TypeScript strict config (ES2017)
├── package.json                  # Dependencies & scripts
└── .env.local                    # Environment variables (not committed)
```

---

## Pages & Routes

| Route | Page | Data Source | Description |
|-------|------|-------------|-------------|
| `/` | Landing | Static + API | Hero, feature showcase, leaderboard preview, CTAs |
| `/dashboard` | Dashboard | `/api/market`, static signals | Market stats, active signals, quick action cards |
| `/hunters` | Explorer | `/api/hunters` → Supabase | Filterable wallet leaderboard with archetype/Sharpe/PnL filters |
| `/smart-money` | Smart Money | `/api/smart-money` → Hyperliquid + Supabase | Token confidence scores, tier breakdowns, sector analysis |
| `/wallet/[address]` | Wallet Profile | `/api/wallets/[address]` → Hyperliquid | Tabbed view: Overview (positions, PnL chart, archetype, token metrics, strategy summary), Trade History (paginated fills), Funding (funding payments) |
| `/copy-trade` | Copy Trade (retired) | static | Explainer for why copy trading was removed; legacy UI quarantined |
| `/quant` | Pocket Quant | `/api/quant/backtest` (mock) | Rule builder, strategy templates, mock backtester |
| `/performance` | Performance | Hardcoded demo data | Copy-trade performance attribution and trade log |
| `/agent` | AI Agent | `/api/agent` → Claude API + Hyperliquid + Supabase | Natural language queries for wallet data, market analysis, and PnL lookups |
| `/alerts` | Alert Center | `/api/signals` | Live signals and consensus from the signals table; settings honestly marked not-yet-wired |
| `/watchlist` | Watchlist | Zustand (client-only) | Manage wallet watchlists (not persisted to DB) |
| `/learn` | Learn | Static | Educational content on archetypes, tiers, metrics |

---

## API Endpoints

### Live (Connected to Hyperliquid / Supabase)

| Endpoint | Method | Source | Description |
|----------|--------|--------|-------------|
| `/api/market` | GET | Hyperliquid `metaAndAssetCtxs` | 24h volume, open interest, top gainers, heatmap data |
| `/api/wallets/[address]` | GET | Hyperliquid (`clearinghouseState`, `portfolio`, `userFundings`, `userFillsByTime`) | Full wallet state, portfolio history, funding PnL, last 90 days of fills |
| `/api/wallets` | GET | Supabase `wallets` table | Top 100 wallets by Sharpe (used by watchlist) |
| `/api/hunters` | GET | Supabase `wallets` table | Paginated wallet leaderboard with filtering and sorting |
| `/api/smart-money` | GET | Hyperliquid + Supabase | Token-level analysis, tier classification, sector insights |
| `/api/seed` | GET/POST | Hyperliquid `recentTrades` → Supabase | Discovers wallets from recent trades, computes metrics, seeds DB |
| `/api/copy-trade` | GET/POST | none | Returns 410 Gone — feature retired after backtest evidence |
| `/api/agent` | POST | Claude API + Hyperliquid + Supabase | AI agent that interprets natural language queries and uses tools to fetch live data |

### Implementation Notes

All previously stubbed endpoints are now implemented: `/api/signals` (real
signals + consensus from Supabase), `/api/quant/backtest` (real candleSnapshot
data feeding the client-side engine), `/api/quant/rules`, `/api/leaderboard`,
`/api/scanner`, and `/api/stream` (Edge SSE). `/api/copy-trade` intentionally
returns 410 Gone. Known caveat: the Edge SSE routes construct outbound
WebSockets, which Vercel's Edge runtime does not support in production — the
signal-generation path is being moved into the capture daemon.

---

## External API Integrations

### Hyperliquid REST API

**Base URL:** `https://api.hyperliquid.xyz/info`
**Auth:** None required (public API)
**Method:** All requests are POST with JSON body

| API Call | Used In | Purpose |
|----------|---------|---------|
| `{ type: "metaAndAssetCtxs" }` | `/api/market`, `/api/smart-money` | Asset metadata, prices, volume, OI |
| `{ type: "clearinghouseState", user }` | `/api/wallets/[address]`, `/api/seed` | Account positions, margin, equity |
| `{ type: "portfolio", user }` | `/api/wallets/[address]` | Historical PnL curves (day/week/month/allTime) |
| `{ type: "userFillsByTime", user, startTime }` | `/api/wallets/[address]` | Trade fills for last 90 days |
| `{ type: "userFundings", user, startTime }` | `/api/wallets/[address]` | Funding rate payments |
| `{ type: "recentTrades", coin }` | `/api/seed` | Recent trades to discover active wallets |
| `{ type: "userFills", user }` | `lib/hyperliquid/client.ts` | All user fills (used by Python analytics) |
| `{ type: "leaderboard" }` | `lib/hyperliquid/client.ts` | Hyperliquid leaderboard (not actively used) |
| `{ type: "l2Book", coin }` | `lib/hyperliquid/client.ts` | Order book (available but unused in UI) |
| `{ type: "candleSnapshot", req }` | `lib/hyperliquid/client.ts` | OHLCV candles (available but unused in UI) |

**Hyperliquid API docs:** [https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api)

### Hyperliquid WebSocket

**URL:** `wss://api.hyperliquid.xyz/ws`
**Status:** Client is fully implemented in `lib/hyperliquid/websocket.ts` but **not actively connected** in any page. The WebSocket class supports:
- `subscribeUserEvents(address)` — Position/fill updates for a wallet
- `subscribeTrades(coin)` — Real-time trades on an asset
- `subscribeAssetCtx(coin)` — Real-time asset context updates
- Auto-reconnect with exponential backoff (up to 5 attempts)

### Supabase

**Client:** `@supabase/supabase-js` v2
**Tables used:** `wallets`, `copy_trade_configs`
**Tables in migration but not actively used:** `fills`, `positions`, `alerts`, `watchlists`, `quant_rules`, `alert_configs`

### Upstash Redis

**Client:** `@upstash/redis` v1
**Status:** Client is initialised in `lib/cache/redis.ts` but **not actively used** in any API route yet. Intended for caching Hyperliquid API responses to reduce latency and avoid rate limits.

### Telegram Bot API

**Status:** Helper functions are implemented in `lib/notifications/telegram.ts`. The `sendTelegramAlert()` function and `formatTradeAlert()` formatter are ready. **Not connected** to any live trigger — requires a signal pipeline or webhook processor to call them.

### ntfy.sh

**Status:** Helper function implemented in `lib/notifications/ntfy.ts`. Ready to send push notifications to any ntfy.sh topic. **Not connected** to any live trigger.

### Anthropic (Claude) API

**Client:** `@anthropic-ai/sdk`
**Used in:** `app/api/agent/route.ts`
**Models:**
- **Haiku** (`claude-haiku-4-5-20251001`) — Default. Fast and affordable, ideal for data lookups.
- **Sonnet** (`claude-sonnet-4-6`) — Optional upgrade via drop-up toggle. Deeper analysis.

**Status:** Fully implemented and connected. The AI Agent uses Claude with tool use to interpret natural language queries and call 7 tools:

| Tool | Description |
|------|-------------|
| `search_wallets` | Query Supabase wallets table with filters (PnL, win rate, Sharpe, archetype, leverage, trades) |
| `get_wallet_state` | Fetch live positions, account value, margin from Hyperliquid |
| `get_wallet_pnl` | Retrieve historical PnL across all timeframes from the portfolio endpoint |
| `get_wallet_fills` | Get recent trade fills with summary stats (win rate, top assets, PnL) |
| `get_market_overview` | Get 24h volume, open interest, top gainers/losers |
| `get_asset_info` | Look up specific asset price, 24h change, volume, funding rate |
| `scan_wallets_by_period` | Scan ALL tracked wallets to find top performers over a custom time period (1-90 days). Fetches live fills from Hyperliquid for every wallet, computes exact realized PnL and return %. Supports min return % and min PnL filters. Processes wallets in parallel batches of 15. |

The agent runs an agentic loop (up to 10 rounds of tool calls) and returns a formatted answer with clickable wallet addresses. Requires `ANTHROPIC_API_KEY` env var. Get one at [console.anthropic.com](https://console.anthropic.com).

**Frontend features:**
- Model selector drop-up (Haiku/Sonnet) with descriptions
- Tool call badges showing which data sources were queried
- Wallet addresses displayed as white underlined text, clickable to wallet detail page
- Copy-to-clipboard button on every address
- Suggested query cards on empty state
- Markdown-like formatting: bold, code, tables, lists, headers

---

## Capture Service

`capture-service/index.mjs` is the always-on daemon that captures Hyperliquid
fills and 1m candles into Supabase for the verification engine (WS
subscriptions plus a rotating REST sweep, idempotent writes, heartbeats to
`capture_health`).

### Capture scope (`SWEEP_SCOPE`)

The daemon originally swept every tracked wallet (~7,000). At that scope the
`fills` table reached **3.8GB** and was growing **4-10GB/month** — unbounded
disk growth for wallets nothing downstream reads. Capture now concentrates on
the classified cohort, enforced by a flag rather than a convention:

- `wallets.capture_enabled` (migration `014_capture_scope.sql`, default
  `false`) is set for every classified wallet (`archetype not null`), plus
  any wallet referenced by an active signal or a verification job spec.
- `SWEEP_SCOPE=cohort` (the default) makes both the WS subscription set and
  the rotating REST sweep read only `capture_enabled` wallets (paginated —
  PostgREST caps responses near 1000 rows).
- `SWEEP_SCOPE=all` is an explicit override that restores the full sweep.

The candle coin universe is unchanged (still driven by `recent_fill_coins`).
Existing fills from out-of-scope wallets are kept — they simply stop
accumulating; nothing is deleted.

---

## Database Schema

The database has 7 tables defined in `supabase/migrations/001_init.sql`. Only 2 are actively used by the application:

### Actively Used Tables

**`wallets`** — Tracked wallet analytics
```sql
address              text PRIMARY KEY    -- Ethereum address
label                text                -- Display name
archetype            text                -- scalper, momentum_trader, etc.
archetype_confidence float               -- 0.0 to 1.0
sharpe_7d            float               -- 7-day Sharpe ratio
sharpe_30d           float               -- 30-day Sharpe ratio
sharpe_90d           float               -- 90-day Sharpe ratio
alpha_decay_score    float               -- Consistency metric (0 = no decay)
win_rate             float               -- Win percentage (0.0 to 1.0)
total_pnl_usd        float               -- Lifetime PnL in USD
trade_count_30d      int                 -- Number of trades in last 30 days
avg_hold_seconds     int                 -- Average position hold time
avg_leverage         float               -- Average leverage used
most_traded_asset    text                -- Most frequently traded token
is_seeded            boolean             -- True if from auto-discovery
capture_enabled      boolean             -- Capture scope flag (see Capture Service)
last_updated         timestamptz
created_at           timestamptz
```

**`copy_trade_configs`** — Copy-trade setups (composite PK: user_address + target_address)
```sql
user_address         text                -- User's wallet
target_address       text                -- Wallet being copied
ratio                int                 -- Copy percentage (1-1000)
max_position_size    float               -- Max position in USD
delay_seconds        int                 -- Execution delay
included_categories  text                -- Asset category filter
excluded_assets      text                -- Blacklisted tokens
enabled              boolean             -- Active toggle
updated_at           timestamptz
```

### Defined But Not Yet Connected

| Table | Purpose | Status |
|-------|---------|--------|
| `fills` | Time-series trade fills (TimescaleDB hypertable) | Schema exists, not written to |
| `positions` | Position snapshots (TimescaleDB hypertable) | Schema exists, not written to |
| `alerts` | Alert event log | Schema exists, not written to |
| `watchlists` | User watchlists | Schema exists — watchlists currently stored client-side in Zustand |
| `quant_rules` | Saved strategy rules | Schema exists, not written to |
| `alert_configs` | Notification delivery settings | Schema exists, not written to |

**Note:** The `fills` and `positions` tables use TimescaleDB hypertables (`create_hypertable()`). You'll need the TimescaleDB extension enabled in your Supabase project, or remove those lines if using standard Postgres.

---

## Analytics Engine

### TypeScript (In-App) — `lib/analytics/`

These run client-side in the browser when viewing a wallet profile:

**Archetype Detection** (`archetype.ts`)
Classifies wallets into 7 types based on scoring across multiple signals:
- Hold time (seconds between trades)
- Trade frequency
- Average leverage
- PnL distribution (mean, std, consistency)
- Delta neutrality (long/short balance)

Archetypes: `scalper`, `swing_trader`, `momentum_trader`, `high_conviction`, `funding_arb`, `farmer`, `market_maker`

**PnL Analytics** (`pnl.ts`)
- `computeDailyPnl(fills)` — Aggregates fills into daily PnL
- `computeSharpe(dailyPnl)` — Annualised Sharpe ratio (×√365)
- `computeSharpeFromFills(fills, days)` — Sharpe from raw fills
- `computeWinRate(fills)` — Percentage of trades with positive `closedPnl`
- `computeMaxDrawdown(dailyValues)` — Peak-to-trough decline
- `computeTotalPnl(fills)` — Sum of all `closedPnl`

**Alpha Decay** (`alphaDecay.ts`)
Compares recent vs older Sharpe ratios to measure if a wallet's edge is decaying. Score of 0 = no decay, higher = fading alpha.

**Technical Indicators** (`indicators.ts`)
- `computeRSI(prices, period)` — Relative Strength Index
- `computeEMA(prices, period)` — Exponential Moving Average
- `computeATR(highs, lows, closes, period)` — Average True Range

These are used by the strategy builder rules but can be applied anywhere.

### Equity Tier System

Wallets are classified into tiers by account value (defined in `/api/smart-money`):

| Tier | Account Value | Label |
|------|--------------|-------|
| Leviathan | > $10M | Institutional-grade |
| Whale | $1M - $10M | Major market mover |
| Shark | $250K - $1M | Professional trader |
| Dolphin | $50K - $250K | Experienced retail |
| Fish | $10K - $50K | Active retail |
| Shrimp | < $10K | Small retail |

### Smart Money Confidence Score

Each token gets a confidence score (0-10) based on:
- **Participation** — Number of tracked wallets with positions
- **Consensus** — Agreement on direction (long vs short)
- **Whale weight** — Positions from higher equity tiers
- **Liquidity** — Total notional value in positions

---

## Python Analytics Service

A standalone FastAPI service in `analytics-service/` mirrors the TypeScript analytics with Python/Pandas/NumPy for heavier computation.

### Running the Service

```bash
cd analytics-service
pip install -r requirements.txt
python main.py  # Starts on http://localhost:8000
```

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/analytics/score/{address}` | GET | Compute full wallet scoring (Sharpe, win rate, PnL, drawdown) |
| `/analytics/profile/{address}` | GET | Scoring + archetype detection |

### Components

- **`ingestion/hyperliquid.py`** — Async HTTP client for Hyperliquid API
- **`ingestion/scheduler.py`** — APScheduler background job (leaderboard ingestion every 15 min)
- **`analytics/scoring.py`** — PnL series, Sharpe, win rate, alpha decay, max drawdown
- **`analytics/archetyping.py`** — Archetype detection (mirrors TypeScript version)
- **`analytics/indicators.py`** — RSI, EMA, ATR, ADX technical indicators

### Dependencies

```
fastapi, uvicorn, httpx, pandas, numpy, scipy,
supabase, apscheduler, python-dotenv,
hyperliquid-python-sdk
```

**Status:** This service is **not deployed** by default. The Next.js app handles all analytics client-side. This service is intended for:
- Batch processing large wallet sets
- Background ingestion pipelines
- More computationally intensive analysis

---

## Wallet Connection

The app uses a simple Web3 wallet integration via `lib/wallet/WalletContext.tsx`:

- **Standard:** EIP-1193 (`window.ethereum`)
- **Supported wallets:** MetaMask and any EIP-1193 compatible wallet
- **Method:** `eth_requestAccounts`
- **Persistence:** Connected address stored in `localStorage` as `connected_wallet`
- **Security:** Read-only — no private keys are handled, no transactions are signed
- **Usage:** The connected wallet address is used for:
  - Identifying the user for copy-trade configs
  - Filtering performance data
  - Personalising the dashboard

There is **no backend authentication**. The wallet address serves as the user identifier for Supabase queries.

---

## State Management

### Server State
- API routes fetch from Hyperliquid/Supabase on each request
- Wallet portfolio data is cached in `localStorage` with a 5-minute TTL

### Client State (Zustand)

| Store | File | Persistence | Purpose |
|-------|------|-------------|---------|
| `useWatchlistStore` | `lib/store.ts` | Memory only (lost on refresh) | Watchlists with wallet addresses |
| `useAlertStore` | `lib/store.ts` | Memory only | Alert history (max 100 entries) |
| `useHunterFilters` | `lib/store.ts` | Memory only | Leaderboard filter state |

### React Context

| Context | File | Purpose |
|---------|------|---------|
| `WalletContext` | `lib/wallet/WalletContext.tsx` | Connected wallet address, connect/disconnect methods |

**Note:** Watchlists are currently in-memory only. The Supabase `watchlists` table exists but is not connected. Persisting watchlists to the database is a planned feature.

---

## Placeholder & Mock Data

### Hardcoded Demo Data

| Location | Data | Notes |
|----------|------|-------|
| `app/page.tsx` (Landing) | 3 sample wallets in leaderboard preview | Addresses, PnL, win rates are illustrative |
| `app/dashboard/page.tsx` | 3 demo signals (ETH, HYPE, XRP) | Static signal cards shown when no wallets are tracked |
| `app/performance/page.tsx` | 5 mock copy trades | Demo trade log with realistic fill data |
| `app/copy-trade/page.tsx` | 3 preview trader cards (blurred) | Shown before wallet connection |
| `lib/walletAliases.ts` | 7 wallet aliases | Human-readable names for known wallets |
| `app/api/smart-money/route.ts` | Asset category mappings | 20+ crypto assets mapped to sectors (L1, DeFi, Meme, etc.) |
| `app/api/seed/route.ts` | Discovery coin list | 20 coins used for wallet discovery via `recentTrades` |

### Mock / Simulated Engines

| Feature | Status | Details |
|---------|--------|---------|
| **Backtest Engine** (`/api/quant/backtest`) | Simulated | Returns a random-walk equity curve, not real historical backtesting |
| **Signal Pipeline** (`/api/signals`) | Stub | Returns empty arrays; needs WebSocket integration |
| **Streaming** (`/api/stream`) | Stub | Returns placeholder message |
| **Scanner** (`/api/scanner`) | Stub | Returns empty array |
| **Leaderboard** (`/api/leaderboard`) | Stub | Returns empty object |

---

## Known Limitations & TODOs

### Critical / High Priority

1. **No trade execution** — Copy trading is configuration only. Building the actual execution engine requires signing transactions via the Hyperliquid SDK.

2. **Signal pipeline not connected** — The `ActiveSignalsFeed` and `ConsensusAlerts` components exist but the `/api/signals` endpoint returns empty data. Requires connecting the WebSocket client to a processing pipeline.

3. **Watchlists not persisted** — Stored in Zustand (browser memory). Should be connected to the Supabase `watchlists` table.

4. **Quant rules not saved** — Strategy rules are local state only. The `quant_rules` Supabase table exists but `/api/quant/rules` is a stub.

5. **Performance page uses hardcoded data** — The trade log shows 5 demo trades. Needs a real trade tracking pipeline.

### Medium Priority

6. **Redis caching not implemented** — The Upstash Redis client is initialised but no API route uses it. Adding caching would reduce Hyperliquid API calls and improve latency.

7. **Alert delivery not triggered** — Telegram and ntfy.sh functions are built but nothing calls them. Needs a webhook processor or background job that detects new positions and sends alerts.

8. **TimescaleDB dependency** — The migration uses `create_hypertable()` which requires the TimescaleDB extension. Standard Supabase projects may not have this enabled.

9. **No rate limiting** — API routes don't implement rate limiting. The Hyperliquid API is public but heavy usage could lead to throttling.

10. **No error boundaries** — Pages don't use React Error Boundaries. A failing component crashes the entire page.

### Design Notes for Developers

- **Colour scheme:** Positive values use `#34EAB9` (teal green), negative values use `#FF3B5C` (coral red), backgrounds are `#0F1A1E` (dark navy), text is `#F0FAF8` (off-white). These are consistent across all components.

- **Fonts:** Inter (body), Source Serif 4 (display headings), JetBrains Mono (data/numbers). Loaded via CSS, not next/font.

- **Currency formatting:** Most components use a `formatUsd(n)` helper that formats to `$X.XM` / `$XK` / `$X` notation. PnL values include `+`/`-` prefix.

- **Mobile:** The app uses a top Navbar on desktop and a fixed BottomNav on mobile. Pages use responsive Tailwind classes (`sm:`, `md:`, `lg:`) but some grid layouts may need further testing on small screens.

---

## Deployment

### Vercel

The project is deployed on Vercel with:
- Automatic builds from the GitHub repository
- Serverless API routes
- Cron job running `/api/seed` every 6 hours (configured in `vercel.json`)
- Environment variables set in Vercel Dashboard

### Railway

Also deployable on Railway:
- Automatic builds via Railpack (detects Next.js)
- Set environment variables in Railway Dashboard (Variables tab)
- **Important:** The Supabase client is lazy-initialized (`getSupabase()`) to avoid `supabaseUrl is required` errors during Railway's build-time static page collection. Do not revert this to eager initialization.

### Deployment Checklist

1. Set all environment variables in your hosting platform (Vercel Dashboard or Railway Variables)
2. Run the Supabase migration (`001_init.sql`)
3. Disable RLS on the `wallets` table (or configure policies)
4. Trigger an initial seed: visit `/api/seed` after deployment
5. (Vercel only) Verify the cron job is registered in Vercel Dashboard → Settings → Crons

---

## Developer Notes

### Adding a New Page

1. Create `app/your-page/page.tsx` with `'use client'` directive
2. Add the route to `components/layout/Navbar.tsx` navigation links
3. Add to `components/layout/BottomNav.tsx` if it should appear on mobile
4. The page will be automatically wrapped by `AppShell` (navbar) and `WalletProvider`

### Adding a New API Route

1. Create `app/api/your-route/route.ts`
2. Use `validateAddress()` from `lib/validation.ts` for any address inputs
3. Use `validateSortColumn()` and `safeParseInt()` for query parameters
4. Import `getSupabase` from `lib/db/supabase.ts` for database access (lazy-initialized to avoid build-time errors)
5. Use the Hyperliquid client functions from `lib/hyperliquid/client.ts`

### Extending the Archetype System

The archetype classifier is in `lib/analytics/archetype.ts`. To add a new archetype:
1. Add a scoring block similar to existing ones (scalper, momentum, etc.)
2. Scores are 0.0 to 1.0 based on multiple signals
3. The highest-scoring archetype wins
4. Update `components/wallet/ArchetypeBadge.tsx` for the display label and colour

### Key Files to Know

| File | Why It Matters |
|------|---------------|
| `lib/hyperliquid/types.ts` | All TypeScript interfaces for API data |
| `lib/hyperliquid/client.ts` | Central Hyperliquid API client |
| `lib/analytics/archetype.ts` | Core wallet classification logic |
| `lib/analytics/pnl.ts` | All PnL/Sharpe/win-rate calculations |
| `app/api/seed/route.ts` | Wallet discovery and database seeding |
| `app/api/smart-money/route.ts` | Complex analytics aggregation endpoint |
| `lib/wallet/WalletContext.tsx` | Web3 wallet connection state |
| `lib/store.ts` | All Zustand client state stores |
| `lib/validation.ts` | Input sanitisation (security) |
| `components/ui/CopyableAddress.tsx` | Reusable address display with copy + link |
| `components/wallet/TradeHistory.tsx` | Paginated trade fills table |
| `components/wallet/FundingHistory.tsx` | Paginated funding payments table |
| `components/agent/AgentChat.tsx` | AI Agent chat interface with model selector |

### Security Considerations

- All user inputs (addresses, sort columns, numeric params) are validated via `lib/validation.ts`
- HTML/XSS sanitisation is applied via `sanitizeString()`
- Supabase queries use parameterised methods (no raw SQL from user input)
- The anon key in `.env.local` should be treated as semi-public (it's a Supabase anon key with RLS policies)
- No private keys or signing operations are performed
- The Telegram bot token should be kept secret (server-side only)

---

## License

This project is private. Contact the repository owner for licensing information.
