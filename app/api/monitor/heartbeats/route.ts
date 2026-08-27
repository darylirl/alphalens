import { NextResponse, type NextRequest } from 'next/server'
import { getSupabase } from '@/lib/db/supabase'
import { getAdminToken, isAuthorized, safeEqual } from '@/lib/auth/admin'
import { HEARTBEAT_STREAMS } from '@/lib/monitor/thresholds'
import { getIncidentStore, writeMonitorRun, type IncidentMap } from '@/lib/monitor/incidents'
import {
  dataLivenessObservations,
  evaluate,
  foldReadFailures,
  heartbeatObservations,
  type Observation,
} from '@/lib/monitor/checks'
import { formatMessage, sendTelegram, telegramConfigured } from '@/lib/monitor/alerts'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/monitor/heartbeats — the external dead-man's monitor.
 *
 * Runs on a Vercel cron every 15 minutes (see `vercel.json`), OUTSIDE every
 * service it watches. The capture daemon's own watchdog cannot report the
 * daemon's death; this can, because nothing it depends on is the thing it is
 * judging.
 *
 * It checks five streams independently:
 *   capture / verify / scorer  — heartbeat freshness in `capture_health`
 *   fills                      — is anything actually being written
 *   pulse                      — is the aggregate actually being refreshed
 *
 * A daemon can heartbeat while writing nothing, which is why the last two
 * exist: the process being alive and the data being alive are different
 * claims and this monitor makes both separately.
 *
 * Every read is a single bounded row. No schema changes.
 */

/** One bounded read: the newest heartbeat for one service label. */
async function readHeartbeat(service: string) {
  try {
    const { data, error } = await getSupabase()
      .from('capture_health')
      .select('ts')
      .eq('service', service)
      .order('ts', { ascending: false })
      .limit(1)
    if (error) throw new Error(error.message)
    return { seenAt: (data?.[0]?.ts as string | undefined) ?? null }
  } catch (e) {
    return { seenAt: null, readError: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * One bounded read: the newest captured fill.
 *
 * "Zero fills in the last hour" and "the newest fill is over an hour old" are
 * the same predicate; this is the cheap way to ask it (one index tuple on
 * `idx_fills_timestamp` instead of counting ~17k rows), which matters on an
 * instance with a history of being saturated by avoidable work.
 */
async function readNewestFill() {
  try {
    const { data, error } = await getSupabase()
      .from('fills')
      .select('timestamp')
      .order('timestamp', { ascending: false })
      .limit(1)
    if (error) throw new Error(error.message)
    return { seenAt: (data?.[0]?.timestamp as string | undefined) ?? null }
  } catch (e) {
    return { seenAt: null, readError: e instanceof Error ? e.message : String(e) }
  }
}

/** One bounded read: when pg_cron last refreshed `pulse_24h`. */
async function readPulseRefresh() {
  try {
    const { data, error } = await getSupabase()
      .from('pulse_24h')
      .select('computed_at')
      .order('computed_at', { ascending: false })
      .limit(1)
    if (error) throw new Error(error.message)
    return { seenAt: (data?.[0]?.computed_at as string | undefined) ?? null }
  } catch (e) {
    return { seenAt: null, readError: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * The route is protected and fails CLOSED. An unprotected monitor endpoint is
 * a free Telegram-spam handle and a free read of internal service state, so
 * with no secret configured it refuses to run at all rather than defaulting
 * open the way `/api/seed` does.
 *
 * Accepts either the Vercel cron secret (`Authorization: Bearer $CRON_SECRET`,
 * which Vercel attaches to cron invocations automatically) or the admin token
 * / admin cookie, so an operator can trigger a check by hand.
 */
function authorize(req: NextRequest): { ok: true } | { ok: false; status: number; error: string } {
  const cronSecret = process.env.CRON_SECRET
  const adminToken = getAdminToken()

  if (!cronSecret && !adminToken) {
    return {
      ok: false,
      status: 503,
      error: 'Monitor is unprotected: set CRON_SECRET (and/or ADMIN_API_TOKEN) before enabling it',
    }
  }

  const header = req.headers.get('authorization')
  if (cronSecret && header?.startsWith('Bearer ') && safeEqual(header.slice(7), cronSecret)) {
    return { ok: true }
  }
  // isAuthorized covers the admin Bearer token and the admin cookie, but it
  // returns true when no admin token is configured — guard on that here so it
  // can never be the thing that opens the door.
  if (adminToken && isAuthorized(req)) return { ok: true }

  return { ok: false, status: 401, error: 'Unauthorized — cron secret or admin token required' }
}

export async function GET(req: NextRequest) {
  const auth = authorize(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const now = Date.now()
  const checkedAt = new Date(now).toISOString()

  const [beatResults, newestFill, pulseRefresh] = await Promise.all([
    Promise.all(HEARTBEAT_STREAMS.map(s => readHeartbeat(s.service))),
    readNewestFill(),
    readPulseRefresh(),
  ])

  const beats: Record<string, { seenAt: string | null; readError?: string }> = {}
  HEARTBEAT_STREAMS.forEach((s, i) => { beats[s.key] = beatResults[i] })

  const observations: Observation[] = foldReadFailures([
    ...heartbeatObservations(beats),
    ...dataLivenessObservations({
      newestFillAt: newestFill.seenAt,
      fillsReadError: newestFill.readError,
      pulseComputedAt: pulseRefresh.seenAt,
      pulseReadError: pulseRefresh.readError,
    }),
  ], checkedAt)

  const store = getIncidentStore(getSupabase())
  let previous: IncidentMap = {}
  let stateError: string | null = null
  try {
    previous = await store.load()
  } catch (e) {
    // Without prior state we cannot honour "once per incident". Say so and
    // alert anyway: a duplicate message is a smaller failure than silence.
    stateError = e instanceof Error ? e.message : String(e)
  }

  const { verdicts, notifications, nextIncidents } = evaluate(observations, previous, now)

  const sent = []
  for (const n of notifications) {
    const result = await sendTelegram(formatMessage(n, checkedAt))
    sent.push({ stream: n.verdict.key, kind: n.kind, ...result })
    if (!result.delivered) {
      // An undelivered alert must not be recorded as notified, or the retry
      // never happens and the incident goes quiet for real.
      delete nextIncidents[n.verdict.key]
      if (previous[n.verdict.key]) nextIncidents[n.verdict.key] = previous[n.verdict.key]
    }
  }

  const healthy = verdicts.every(v => v.status === 'ok')

  let saveError: string | null = null
  if (!stateError) {
    try {
      await store.save(nextIncidents)
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e)
    }
  }

  // Always, even on a clean run and even when the state write failed: this row
  // is the only evidence that the monitor ran. A cron that stopped firing is
  // otherwise indistinguishable from an unbroken run of good news, which is
  // the exact shape of the outage this monitor exists to catch.
  let runRecordError: string | null = null
  try {
    await writeMonitorRun(getSupabase(), {
      ran: checkedAt,
      healthy,
      store: store.backend,
      open: nextIncidents,
      telegram: telegramConfigured() ? 'configured' : 'unconfigured',
      sent: sent.length
        ? sent.map(n => ({
            stream: n.stream,
            kind: n.kind,
            delivered: n.delivered,
            messageId: n.messageId,
            error: n.error,
          }))
        : undefined,
    })
  } catch (e) {
    runRecordError = e instanceof Error ? e.message : String(e)
  }

  return NextResponse.json({
    checkedAt,
    healthy,
    streams: verdicts.map(v => ({
      stream: v.key,
      label: v.label,
      status: v.status,
      lastSeenAt: v.seenAt,
      silentFor: v.silentForMs,
      thresholdMs: v.thresholdMs,
      source: v.source,
      readError: v.readError ?? null,
      incidentOpenedAt: nextIncidents[v.key]?.openedAt ?? null,
    })),
    notifications: sent,
    state: {
      backend: store.backend,
      // The capture_health backend cannot dedup an alert about the database
      // being unreachable, because writing the dedup record needs the same
      // database. Stated, not hidden.
      dedupBlindSpot: store.degraded ? 'cannot dedup a database-unreachable alert' : null,
      openIncidents: Object.keys(nextIncidents),
      readError: stateError,
      writeError: saveError,
      // Named separately from the state write: losing the run record costs
      // the ability to prove the monitor ran, which is a different failure
      // from losing dedup.
      runRecordError,
    },
    telegram: telegramConfigured() ? 'configured' : 'unconfigured',
  })
}
