/**
 * External dead-man's monitor — the threshold block.
 *
 * WHY THIS EXISTS
 * The capture daemon's Telegram watchdog runs INSIDE the capture daemon
 * (`capture-service/index.mjs`, `heartbeat()`). A process that has died,
 * hung, or been evicted cannot alert on its own death, which is exactly how
 * the Aug 17-25 capture gap ran for eight days without a single message.
 * This monitor therefore runs somewhere else entirely — a Vercel cron route,
 * a different host, a different deploy, a different failure domain — and
 * judges the services only by the evidence they leave in `capture_health`
 * and in the data itself.
 *
 * Every threshold below is derived from an observed cadence, not guessed.
 * Change them here and nowhere else.
 */

/** How often the Vercel cron invokes the monitor (see `vercel.json`). */
export const MONITOR_INTERVAL_MS = 15 * 60_000

export interface HeartbeatStream {
  /** Incident key; stable across runs, used as the state-store field name. */
  key: string
  /** `capture_health.service` value this stream is identified by. */
  service: string
  /** Human name used in the alert text. */
  label: string
  /** Silence beyond this is an incident. */
  staleMs: number
  /** Why the threshold is what it is — quoted in the alert. */
  rationale: string
}

export const HEARTBEAT_STREAMS: HeartbeatStream[] = [
  {
    key: 'capture',
    service: 'capture',
    label: 'capture daemon',
    // capture-service/index.mjs: HEARTBEAT_MS = 60_000, one row per minute.
    staleMs: 3 * 60_000,
    rationale: 'beats every 60s; 3m = three consecutive missed beats',
  },
  {
    key: 'verify',
    service: 'verify',
    label: 'verification worker',
    // verify-service/index.mjs beats on the same one-minute cadence.
    staleMs: 3 * 60_000,
    rationale: 'beats every 60s; 3m = three consecutive missed beats',
  },
  {
    key: 'scorer',
    service: 'scorer',
    label: 'ledger scorer',
    // verify-service/scorer.mjs sets a 60s beat interval, but its work loop
    // ticks every SCORER_POLL_MS (5 min default) and a long tick can delay a
    // beat. 12m tolerates two missed ticks plus slack, so a slow scoring pass
    // is never mistaken for a dead scorer.
    staleMs: 12 * 60_000,
    rationale: 'tick cadence is 5m; 12m = two missed ticks plus slack',
  },
]

/**
 * Data-liveness thresholds. A daemon can heartbeat happily while writing
 * nothing — the heartbeat proves the process loop is alive, not that data is
 * landing. These two signals watch the output instead of the process.
 */

/**
 * Newest captured fill may not be older than this.
 *
 * Stated as "zero fills written in the last hour"; implemented as "the newest
 * fill is at least an hour old", which is the same predicate (a fill inside
 * the window is exactly what a non-zero count means) read with a single-row
 * indexed lookup instead of a 17k-row count. `idx_fills_timestamp` makes the
 * former ~0.1ms; the latter measured 55ms and 12,758 shared buffers, and this
 * instance has a documented history of being saturated by avoidable work.
 *
 * NOT gated on market hours: Hyperliquid perps never close, and the tape says
 * so. Across the 721 consecutive hours ending 2026-08-27T17:00Z, every single
 * hour had fills; the quietest hour of the month carried 677 and the quietest
 * hour-of-day averaged ~13k. There is no hour in which zero is innocent, so
 * arming this only "during market hours" would create a nightly blind spot
 * for no benefit.
 *
 * Note this reads `fills.timestamp`, the exchange's fill time — the table has
 * no write-time column. That is the stricter reading: a backfill of old fills
 * does not refresh it, and only genuinely current capture does.
 */
export const FILLS_MAX_AGE_MS = 60 * 60_000

/**
 * `pulse_24h` refresh age ceiling.
 *
 * pg_cron job `refresh-pulse-24h` runs on a 30-minute schedule, so 90
 * minutes is three consecutive missed refreshes — past any single slow
 * refresh, short of a whole afternoon of stale positioning being served as
 * current.
 */
export const PULSE_MAX_AGE_MS = 90 * 60_000

/**
 * Incident notification policy.
 *
 * One alert when a stream goes stale, one message when it recovers. A stream
 * that stays down does NOT re-alert every run — at a 15-minute cron that is
 * 96 messages a day, and a channel that noisy is a channel nobody reads.
 *
 * It does re-alert once every REALERT_MS, because the opposite failure is
 * real too: a single message at 03:00 that scrolls away is how an outage gets
 * forgotten. Six hours is four reminders a day for a total outage, against
 * the 96 that alerting every run would send.
 */
export const REALERT_MS = 6 * 60 * 60_000
