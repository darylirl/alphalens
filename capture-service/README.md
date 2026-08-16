# AlphaLens forward-capture daemon

Always-on worker that captures out-of-sample Hyperliquid data into Supabase.
Every week this is not running is history that can never be recovered: the
fills API retains only a wallet's most recent ~2000 fills and 1m candles only
~3.5 days.

## What it does

- WebSocket `userFills` subscriptions for the top `WS_WALLET_LIMIT` tracked
  wallets (classified wallets first) and 1m `candle` subscriptions for every
  coin the cohort trades.
- A rotating REST sweep over ALL tracked wallets (`userFillsByTime` with a
  per-wallet cursor). This is the gap-detection path: it heals WS outages and
  is lossless for any wallet doing fewer than ~2000 fills per sweep cycle.
- Hourly `candleSnapshot` sweep per coin: 1m retention is ~3.5 days, so any
  candle outage shorter than that self-heals.
- New wallets get a full forward-paginated backfill; coins whose earliest
  retrievable fill has `startPosition != 0` are recorded in `capture_gaps`
  (their pre-capture history is incomplete — replay engines must not
  fabricate entries for them).
- Idempotent writes: fills upsert on `(wallet_address, tid)`, candles on
  `(coin, t)`. Restarts and overlapping sweeps never duplicate rows.
- Heartbeat row to `capture_health` every minute; Telegram alert if no
  successful write for 5+ minutes.

## Tables (migration 007)

`fills` (+`tid`, `start_position`), `candles_1m`, `capture_health`,
`capture_gaps`.

## Run locally

```
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node index.mjs
```

Node >= 22, zero npm dependencies.

## Deploy (Fly.io)

```
cd capture-service
fly launch --no-deploy          # first time only; keeps this fly.toml
fly secrets set SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=...
fly deploy
fly logs                        # watch heartbeats
```

Railway works identically: new service from this directory, set the same
variables, deploy the Dockerfile.

## Health

Latest heartbeat: `select * from capture_health order by ts desc limit 1;`
The app's "capture live" indicators should read this table and show an honest
empty state when the daemon is down.
