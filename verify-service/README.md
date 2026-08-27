# AlphaLens verification service

Turns a **pre-registered strategy spec** into an **immutable, frictioned,
coverage-disclosed result**. It is the replay engine from `backtest_copy.py`,
refactored from a one-off script into a queue-driven service, with that
script's honesty invariants promoted from comments to enforced tests.

The service does not tell you whether a strategy is good. It tells you what
the strategy did over captured data, under frictions that may never be
reduced, and whether the falsifiers you registered *before* the run were
triggered.

## What it is made of

| File | Role |
| --- | --- |
| `lib/spec.mjs` | Spec schema, rule grammar v1, friction floors, canonical `spec_hash` |
| `lib/db.mjs` | Supabase REST access — every read bounded or paged |
| `lib/market.mjs` | Bar grid + fill-price ladder (tape → captured 1m → candleSnapshot) |
| `lib/cohort.mjs` | Cohort positioning series, the `pulse_24h` shapes over history |
| `lib/indicators.mjs` | EMA / RSI / price-change, `null` until warmed up |
| `lib/engine.mjs` | Replay core + the invariants, as assertions |
| `lib/metrics.mjs` | Metrics, verdict, per-trade CSV |
| `lib/runner.mjs` | One job end to end (publishes the result to the Ledger when eligible) |
| `lib/publish.mjs` | Ledger eligibility rule + call construction and publishing |
| `lib/scorer.mjs` | Resolves due `cohort_signal` calls against captured tape |
| `lib/telegram.mjs` | Ledger channel publisher (separate env from watchdog alerts) |
| `index.mjs` | Worker loop: claim → run → persist → heartbeat |
| `scorer.mjs` | Ledger scorer loop: publish sweep + horizon scoring |
| `enqueue.mjs` | CLI: validate a spec file and enqueue it |
| `announce.mjs` | CLI: post the Ledger's pending announcements (backfill / dry run) |
| `publish-founding.mjs` | One-shot: the Ledger's two founding entries |

Node >= 22, zero npm dependencies — same shape as `capture-service`.

## The invariants (see `test/engine.test.mjs`)

1. **Never fabricate entries for truncated history.** A bar is evaluable only
   once every input it reads is fully covered by captured data: indicator
   warm-up, and a complete cohort lookback whose wallet+coin pairs passed
   `start_position` validation. Pairs in `capture_gaps` are excluded from the
   cohort signal in SQL, and every result lists them. A rule reading an
   uncovered input evaluates to `null` — never to `false` — so it cannot fire.
2. **Per-trade fill granularity disclosure.** Hyperliquid retains ~5000 bars
   per interval (1m→3.5d, 5m→17.4d, 15m→52.1d, 1h→208d, 4h→833d), so "the next
   1m open" does not exist for old history. Fills use the finest retained
   interval and each trade records which one served it, alongside the data
   source that priced it.
3. **Penny-exact reconciliation.** `net == gross - fees` on every trade and on
   the totals, checked to under half a cent. A mismatch aborts the job.
4. **Explicit frictions on every result.** 60s delay, 5 bps adverse slippage,
   0.045% taker fee per side — applied to both sides of every trade, stamped
   on every trade row, carried in the result, and enforced by a database
   `CHECK` constraint. Higher values are allowed; lower are rejected, never
   clamped (see `CLAUDE.md`).

## Spec format (`spec_version: 1`)

See `specs/btc-cohort-flow-flip.json` for a complete example.

```jsonc
{
  "spec_version": 1,
  "hypothesis_text": "...",                    // what you claim, in words
  "universe": { "coins": ["BTC"], "cohort_filters": { /* optional */ } },
  "bar_interval": "1h",                        // evaluation grid; rules read CLOSED bars
  "entry": { "side": "long", "rule": { /* rule */ } },
  "exit":  { "condition": null, "max_holding_time_h": 24 },   // max hold is MANDATORY
  "sizing": { "mode": "fixed_usd", "notional_usd": 1000 },
  "frictions": { "delay_s": 60, "slippage_bps": 5, "taker_fee_pct": 0.045 },
  "window": { "start": "2026-06-17T00:00:00Z", "end": "2026-08-16T00:00:00Z" },
  "kill_criteria": [ { "id": "unprofitable", "metric": "net_pnl_usd", "op": "lte", "value": 0 } ],
  "notes": { "look_ahead_flags": [], "mechanism": "stated", "mechanism_text": "..." }
}
```

### Rule grammar v1

Combinators: `{ all: [...] }`, `{ any: [...] }`, `{ not: ... }`.

| Rule | Shape |
| --- | --- |
| EMA | `{ type: "indicator", indicator: "ema", period, op: price_above\|price_below\|cross_above\|cross_below }` |
| RSI | `{ type: "indicator", indicator: "rsi", period, op: lt\|lte\|gt\|gte\|cross_above\|cross_below, value }` |
| Price change % | `{ type: "indicator", indicator: "price_change_pct", lookback_bars, op, value }` |
| Cohort net flow | `{ type: "cohort", metric: "net_flow_usd", window_h: 24, op, value }` |
| Cohort flow skew | `{ type: "cohort", metric: "net_flow_skew", window_h: 24, op, value }` — `net_flow / notional`, in −1..1 |
| New positions | `{ type: "cohort", metric: "new_position_count", side: long\|short\|net, window_h: 24, op, value }` |
| Session | `{ type: "time", rule: "session", start_utc: "13:30", end_utc: "20:00" }` (may wrap midnight) |
| Day of week | `{ type: "time", rule: "day_of_week", days: ["mon", "tue"] }` |

Anything else is **rejected**, with an error naming the construct and its path:

```
entry.rule.all[1].any[0]: unsupported indicator "vwap" — grammar v1 supports: ema, rsi, price_change_pct
```

Cohort metrics are the `pulse_24h` shapes, evaluated historically from
`cohort_flow_hourly` (migration 011) with the same direction semantics as the
live pulse page — so a rule that fires on the live pulse fires identically in
replay. A rolling read at time *T* covers only hour buckets that **closed**
before *T*; the bucket containing *T* is excluded even on the hour, so no
signal can read its own future.

### Kill criteria

Each is a condition that **kills** the strategy when true, so `pass = not
triggered`. Metrics: `net_pnl_usd`, `win_rate`, `profit_factor`,
`max_drawdown_usd`, `max_drawdown_pct`, `trade_count`, `avg_hold_s`,
`worst_month_pnl_usd`, `positive_month_ratio`. Ops: `lt`, `lte`, `gt`, `gte`.

A criterion whose metric could not be computed (no trades, for instance) is
recorded as **not passed**, not as survived — an unevaluated falsifier proves
nothing, and `verdict.inconclusive` says so.

## Tables (migrations 010 + 011)

- `verification_jobs` — the queue. Claimed via `claim_verification_job()`,
  which does `SELECT ... FOR UPDATE SKIP LOCKED` (PostgREST cannot express row
  locking; without SKIP LOCKED two workers race for one job).
- `verification_results` — **append-only**. `UPDATE`/`DELETE` are revoked from
  every role *and* rejected by a trigger. `CHECK` constraints make a row
  missing its spec, its frictions (below the floors included), its verdict, its
  metrics or its coverage impossible to insert. That is a database guarantee,
  not an application convention.
- `cohort_flow_hourly` (+ `cohort_flow_backfill_state`) — precomputed hourly
  cohort flow, maintained by pg_cron.
- Storage bucket `verification-results` — one per-trade CSV per job.

## The Ledger (migration 015, `/ledger`)

`ledger_calls` is the public, append-only record of published calls, with the
same enforcement as `verification_results` (UPDATE/DELETE revoked and
trigger-rejected). The one carved-out door is a one-time write of the
resolution block (`resolved_at`, `outcome`, `scored_brier`,
`resolution_evidence`) by the scorer, via a column-level grant that the
trigger still validates.

- **Publishing rule** (`lib/publish.mjs`): a verification result reaches the
  Ledger only when the canonical engine produced it AND its spec still passes
  `validateSpec()`. The runner publishes at result time; the scorer's sweep is
  the at-least-once net; a partial unique index on `provenance->result_id`
  makes double-publish impossible. `verification_results` id=1 (pre-grammar
  engine) stays recorded and unpublished, on purpose.
- **Scoring** (`scorer.mjs`, `lib/scorer.mjs`): due `cohort_signal` calls
  resolve against the first captured print at/after `published_at` and
  `resolves_at` (1m candles, then cohort fills; 15-minute search). Missing
  tape is never scored: the scorer waits `SCORER_GRACE_H` (default 24h) for
  late capture, then records `unresolvable` with no Brier score and the gap
  documented. Aggregate/strategy subjects only — a wallet-bearing subject is
  rejected by the database.
- **Telegram** (`lib/telegram.mjs`, migration 023): mirrors the Ledger to the
  public channel [@alphalens_ledger](https://t.me/alphalens_ledger) — every
  new call (kind, claim, verdict or horizon, confidence where there is one,
  permalink) and every resolution (outcome, Brier score, permalink). Plain
  text; a data gap posts as `unresolvable` with no score, exactly as it is
  recorded.

  - **Env:** `LEDGER_TELEGRAM_BOT_TOKEN` + `LEDGER_TELEGRAM_CHANNEL_ID`.
    Deliberately separate from the watchdog alert bot's `TELEGRAM_BOT_TOKEN` /
    `TELEGRAM_CHAT_ID`, and the module refuses to fall back to them: the same
    bot may serve both, the same *chat* may not. Content and alerts never
    share a channel. Unconfigured is a normal state — messages are logged and
    dropped, and nothing else changes.
  - **Post-once:** every announcement claims its `(call_id, phase)` row in
    `ledger_telegram_posts` before sending, so a restart mid-backfill resumes
    instead of replaying. A claim that never posted is retried after ten
    minutes, five times, then left with its error on the row.
  - **Backfill:** the sweep walks `ledger_telegram_pending` oldest event
    first, so a cold channel opens with the autopsy and the verdicts in the
    order they were made. It runs every scorer tick, and on demand:
    `node announce.mjs --dry-run` prints exactly what would be posted;
    `node announce.mjs` posts it.
  - **Never a gate:** a Telegram failure is logged and returned, never thrown.
    The Ledger is the source of truth; the channel is a mirror, and a mirror
    that is down does not stop a publish or a resolution.
  - **Paced:** one message per `LEDGER_TELEGRAM_MIN_INTERVAL_MS` (default
    3.5s, ~17/min against Telegram's ~20/min channel guidance), 10 per tick,
    and a 429's `retry_after` is obeyed rather than fought.

## Run locally

```
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node index.mjs         # worker
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scorer.mjs        # ledger scorer
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node enqueue.mjs specs/btc-cohort-flow-flip.json me                 # enqueue
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node announce.mjs --dry-run                                         # channel preview
npm test                                                              # invariants
```

## Deploy (Railway, its own service)

```
railway init                       # or: new service from this directory
railway variables set SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
railway up
```

`railway.json` builds the `Dockerfile` and runs `node index.mjs` as a
background worker (no HTTP port). Fly.io works identically — the Dockerfile is
the whole contract. One replica: jobs are claimed with SKIP LOCKED, so more
replicas are safe, but a single job is not parallelised.

## Health

```sql
select * from capture_health where service = 'verify' order by ts desc limit 5;
```

The worker heartbeats every minute with its phase, the job it is running, and
its completed/failed counters — the same table the capture daemon uses, so one
query answers "is anything running?". The ledger scorer heartbeats into the
same table as `service = 'scorer'`, so a dead scorer is not masked by the
worker's beats:

```sql
select * from capture_health where service = 'scorer' order by ts desc limit 5;
```

Its note carries `posted=` (channel announcements) alongside `published=` and
`resolved=`. What the channel still owes the Ledger:

```sql
select call_id, phase, event_at from ledger_telegram_pending order by event_at;
select * from ledger_telegram_posts where posted_at is null;   -- stuck claims
```

## API

- `POST /api/verify` — validates the spec (returning **every** problem at
  once), enqueues it, returns `job_id`.
- `GET /api/verify/[id]` — status, and when done the whole result: spec,
  metrics, verdict, data coverage, and a signed URL for the per-trade CSV.
