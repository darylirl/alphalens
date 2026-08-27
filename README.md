# AlphaLens

**Verification-first trading research on Hyperliquid.**

AlphaLens captures real wallet activity on the [Hyperliquid](https://hyperliquid.xyz)
perpetuals DEX, classifies the traders behind it, and turns trading hypotheses
into **pre-registered, frictioned, immutable verdicts**. It exists because we
built the opposite first — a copy-trading product — and then replayed 28,318
smart-money trades with honest frictions before shipping it. It lost money.
We deleted the feature and kept the discipline that killed it.

The product is not signals. The product is the verdict — including, and
especially, the negative ones.

**Live deployment:** [alphalens-taupe.vercel.app](https://alphalens-taupe.vercel.app)

---

## The evidence that shaped the product

Both datasets are in this repo under [`backtest_results/`](backtest_results/),
per-trade, so you can check us. The full write-up is published in-app at
[`/research/copy-trading-autopsy`](https://alphalens-taupe.vercel.app/research/copy-trading-autopsy).

**Run 1 — naive copy-trading** (top 10 directional wallets by 30d Sharpe,
one month of fills, $1,000 fixed notional per mirror):
**7,499 trades, net −$1,251.58** after a 60s decision delay, 5 bps adverse
slippage, and 0.045% taker fee per side.
Files: [`trades.csv`](backtest_results/trades.csv),
[`monthly_pnl.csv`](backtest_results/monthly_pnl.csv),
[`summary_by_wallet.csv`](backtest_results/summary_by_wallet.csv).

**Run 2 — copyability-first** (only wallets an outsider could actually
mirror: swing/momentum styles, median hold ≥ 4h, ≤ 500 trades per 30d, ≥ 3
months of complete replayable history; the replay itself spans Aug 2025 –
Aug 2026): **28,318 trades, net −$9,704.42**,
win rate 34.4%, profit factor 0.90. Delay sensitivity is flat (60s → 300s
changes net PnL by ~$5), so latency is not the excuse — the edge simply does
not survive frictions.
Files: [`v2_trades.csv`](backtest_results/v2_trades.csv),
[`v2_delay_sensitivity.csv`](backtest_results/v2_delay_sensitivity.csv),
[`v2_summary_by_archetype.csv`](backtest_results/v2_summary_by_archetype.csv).

**Live verification ledger** — the same discipline, running as a service.
The first canonical entry: job 4 ("when the 24h cohort net flow into BTC
flips positive, go long for 6h"), replayed by `verify-engine@1.0.0` over 60
days of captured cohort data. **Verdict: killed** (35 trades, net −$66.55
after frictions; the pre-registered `unprofitable` falsifier fired). The
deployed worker reproduced the earlier local run **byte-identically** — same
spec hash, same trade count, same PnL to the sixth decimal — which is the
property the whole pipeline is built around: a spec is a claim, a result is
a deterministic replay of it.

---

## Architecture

```
app/                  Next.js 14 frontend + API routes (Vercel)
│                     /pulse, wallet explorer, sandbox backtester, AI agent;
│                     POST /api/verify enqueues a hypothesis (admin-gated),
│                     GET  /api/verify/[id] serves results publicly;
│                     GET  /api/monitor/heartbeats is the external
│                     dead-man's monitor (Vercel cron, every 15 min)
│
capture-service/      Always-on capture daemon (Node 22, zero deps; Railway)
│                     WS fills + 1m candles, rotating REST sweep over the
│                     capture_enabled cohort, idempotent writes, heartbeats,
│                     start_position completeness checks -> capture_gaps
│
verify-service/       The canonical verification engine (Node 22, zero deps)
│                     Spec grammar v1 + friction floors, queue worker
│                     (claim -> replay -> persist), invariant tests,
│                     enqueue/backfill CLIs. See verify-service/README.md
│
mcp-service/          Read-only MCP server for AI agents (Node 22, zero deps)
│                     Four tools over the PUBLIC API — pulse, Ledger list,
│                     Ledger detail, cohort. No database access: the app and
│                     the MCP are both clients of the same public endpoints.
│                     See mcp-service/README.md
│
verification/         Earlier standalone Python replay stack, kept as
│                     experimental reference. New work goes in verify-service/
│
analytics-service/    Optional FastAPI scoring/ingestion service
supabase/migrations/  Schema as numbered SQL, applied in order
backtest_copy.py      The original autopsy script (runs 1 and 2 above)
```

Data flows one way: Hyperliquid → capture (`fills`, `candles_1m`,
`capture_gaps`, `capture_health`) → hourly cohort aggregate
(`cohort_flow_hourly`, coverage-aware) → verification
(`verification_jobs` → `verification_results`, append-only).

---

## Invariants

These are enforced in code, tests, and database constraints — not just
documented. The full statement lives in [`CLAUDE.md`](CLAUDE.md); the load-
bearing ones:

**No fabricated data, anywhere, ever.** Every number shown to a user or
written to the database traces to a real source (Hyperliquid fills, captured
candles, a completed replay) or is an honest empty state. Timestamps are
never synthesized to simulate recency. Schematic visuals are captioned
"Illustration".

**Missing data is never zero.** Zero is a measurement; a missing bucket is
the absence of one. Uncovered hours carry NULL through the whole pipeline
(`cohort_flow_series` exposes `covered boolean`), rolling windows over any
uncovered bucket are NULL, and rules evaluate NULL as "cannot fire" (Kleene
logic), never as false or flat. We learned this the honest way: a
zero-filled outage once manufactured entry signals out of downtime.

**The friction floors may never be reduced.** Every replay applies at least
a 60s decision-to-fill delay, 5 bps adverse slippage, and 0.045% taker fee
per side. Lower values are rejected at validation time and again by a
database CHECK constraint (`verify_frictions_ok`). There is no gross-returns
mode.

**Results are append-only.** `verification_results` rejects UPDATE and
DELETE at the trigger and via revoked grants. A wrong result is answered by
a new run, never an edit.

**Every PostgREST read is explicitly paginated or bounded.** Supabase's REST
layer silently truncates near 1,000 rows; every read in this codebase either
states an intentional limit or pages until a short page.

---

## Reproduce our numbers

For skeptics — which is the intended audience.

### The copy-trading autopsy (`backtest_copy.py`)

Python 3.10+, **standard library only** (no `pip install`). It needs a
Supabase project holding the `wallets` table for cohort selection
(`SUPABASE_URL` + `SUPABASE_ANON_KEY` in env or `.env.local`); every fill
and candle it replays comes from Hyperliquid's **public** API with forward
pagination and per-coin `startPosition` completeness checks.

```bash
python3 backtest_copy.py                        # run 1 (naive Sharpe cohort)
python3 backtest_copy.py --cohort copyability   # run 2 (copyability gates)
```

Don't have our database? The exact cohort is published: the wallet addresses
(and per-wallet results) for both runs are in
`backtest_results/summary_by_wallet.csv` and
`backtest_results/v2_summary_by_wallet.csv`. The replay method — position
reconstruction, partial-close fractions, the friction stack, force-close
handling — is documented at the top of the script.

### The verification engine (`verify-service/`)

Node ≥ 22, zero npm dependencies.

```bash
cd verify-service
npm test                                        # invariant tests, no network
node enqueue.mjs specs/btc-cohort-flow-flip.json  # validate + enqueue a spec
npm start                                       # worker: claim -> replay -> persist
```

Requires `SUPABASE_URL` + a key in env, pointed at a database with the
schema from `supabase/migrations/`. The engine refuses specs below the
friction floors, refuses to evaluate rules over uncovered data, reconciles
`net == gross − fees` per trade to under half a cent, and stamps every
result with its actual data coverage (window served, granularity mix, source
mix, excluded wallet+coin pairs).

Determinism check: enqueue the same spec twice and diff the two result rows'
`metrics` — this is exactly how job 4 reproduced job 3 byte-identically.

---

## Running the app

```bash
npm install
npm run dev        # http://localhost:3000
```

`.env.local` (never committed; `.gitignore` covers all `.env*` variants):

```env
# Required — Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key

# Optional
UPSTASH_REDIS_REST_URL=...        # API response caching
UPSTASH_REDIS_REST_TOKEN=...
TELEGRAM_BOT_TOKEN=...            # stall alerts (daemon + external monitor)
TELEGRAM_CHAT_ID=...              # the chat those alerts go to (operational)
LEDGER_TELEGRAM_BOT_TOKEN=...     # Ledger → @alphalens_ledger (content); may be
LEDGER_TELEGRAM_CHANNEL_ID=@...   # the same bot, never the same chat as the alerts
CRON_SECRET=...                   # protects the Vercel cron routes
ANTHROPIC_API_KEY=sk-ant-your-key # AI agent
ADMIN_API_TOKEN=...               # gates wallet management + POST /api/verify;
                                  # also unlocks the /admin console
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Apply `supabase/migrations/*.sql` in numeric order to a fresh Supabase
project. The capture daemon (`capture-service/`) and the verification worker
(`verify-service/`) run as separate always-on processes (we use Railway);
both are single-file Node 22 services with zero npm dependencies.

The MCP server (`mcp-service/`) needs no credentials at all — it reads the
public API over HTTP and nothing else. Point an MCP client at
`node mcp-service/index.mjs`; see
[`mcp-service/README.md`](mcp-service/README.md) for Claude Desktop and
generic client configuration, and [`/docs/api`](https://alphalens-taupe.vercel.app/docs/api)
for the endpoints it wraps.

Note: public hypothesis submission (`POST /api/verify`) is planned but
stays admin-gated pending rate limiting. Reads are public.

---

### The admin console (`/admin`)

Privileged actions in the browser instead of a shell: enqueue a verification
from a committed spec (validated against grammar v1 client-side, by the same
`verify-service/lib/grammar.mjs` the engine runs), watch the job queue, flip
`capture_enabled` and re-run classification on wallets, and read which
verification results reached the Ledger and which are held back and why.

Sign in with `ADMIN_API_TOKEN` once; it is stored in an httpOnly, secure,
8-hour cookie that the existing `isAuthorized()` gate already accepts, so every
control is an ordinary call to an API that already exists. The page adds no
capability, only a way to reach the ones already there without pasting a token
into a terminal. It is `noindex`, `Disallow`ed in `robots.txt`, and absent from
the sitemap and both nav bars — unlisted, not secret; the token is the gate.

Nothing here writes to the Ledger: publishing stays with the runner and the
scorer, through the one tested path in `verify-service/lib/publish.mjs`.

---

## The external dead-man's monitor

The capture daemon has always had a Telegram watchdog. It runs *inside the
capture daemon*, which means a daemon that has died, hung, or been evicted
sends nothing at all — which is exactly how the Aug 17-25 capture gap ran for
eight days unnoticed. A watchdog that shares a process with the thing it
watches is not a watchdog.

`GET /api/monitor/heartbeats` is the replacement, and it lives outside every
service it judges: a Vercel cron route, on a 15-minute schedule, in a
different failure domain from Railway and from the database writers. It
checks six streams independently and each opens its own incident:

| Stream | Evidence | Threshold | Why |
| --- | --- | --- | --- |
| `capture` | `capture_health` where `service='capture'` | 3 min | beats every 60s; three missed beats |
| `verify` | `capture_health` where `service='verify'` | 3 min | beats every 60s; three missed beats |
| `scorer` | `capture_health` where `service='scorer'` | 12 min | 5-minute tick cadence; two missed ticks plus slack |
| `fills` | newest `fills.timestamp` | 60 min | a daemon can heartbeat while writing nothing |
| `pulse` | newest `pulse_24h.computed_at` | 90 min | pg_cron refreshes every 30 min; three missed refreshes |
| `database` | whether the reads above worked at all | — | a total read failure is one outage, not six |

All six thresholds live in one block in `lib/monitor/thresholds.ts`, each with
the observed cadence it was derived from. Every read is a single bounded row.

**Zero fills is not gated on market hours.** Hyperliquid perps never close,
and the tape agrees: across the 721 consecutive hours ending 2026-08-27T17:00Z
every hour had fills, the quietest carried 677, and the quietest hour-of-day
averaged ~13k. There is no hour in which zero is innocent, so gating this
would buy a nightly blind spot and nothing else.

**Absence of measurement is never reported as health.** A read that fails, or
succeeds and returns no rows, is `unknown` — not `ok`, and not a silence
duration computed against a timestamp that does not exist. The alert says
"cannot be measured" and names the read that failed.

**One message per incident.** Incident state lives in Upstash Redis when
configured, otherwise in `capture_health` rows tagged `service='monitor'` (no
schema change; every existing reader already filters on `service`). A stream
that stays down re-alerts once every 6 hours, not once every 15 minutes, and
sends a single message when beats resume. The response reports which backend
actually ran rather than assuming, and the `capture_health` fallback declares
its one blind spot — it cannot dedup an alert about the database being
unreachable, because writing the dedup record needs the same database. Redis
is preferred for exactly that reason.

**The route fails closed.** It refuses to run at all unless `CRON_SECRET` or
`ADMIN_API_TOKEN` is set, and then requires one of them; there is no open mode.
Vercel attaches `Authorization: Bearer $CRON_SECRET` to cron invocations
automatically.

Required Vercel environment variables:

| Variable | Purpose |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | the existing operational watchdog bot |
| `TELEGRAM_CHAT_ID` | the chat it alerts into |
| `CRON_SECRET` | protects the route; Vercel sends it on cron runs |
| `SUPABASE_SERVICE_ROLE_KEY` | needed to write incident state without Upstash (`anon` has SELECT only on `capture_health`) |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | optional, preferred incident store |

Alerts carry an `[alphalens-monitor]` prefix, distinct from the daemon's
`[alphalens-capture]`, so you can tell which of the two is still able to speak.

---

## What this is not

- Not financial advice, and not a signal service. Verdicts describe what a
  strategy **did** over captured data under pessimistic frictions.
- Not survivorship-curated: killed results are retained and published under
  the same rules as passing ones. As of today every canonical verdict in
  the ledger is a kill; nothing has passed yet.
- Not a promise that capture is complete: coverage is measured and every
  result declares the coverage it actually had.

## License

[MIT](LICENSE)
