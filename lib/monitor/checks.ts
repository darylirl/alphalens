import {
  FILLS_MAX_AGE_MS,
  HEARTBEAT_STREAMS,
  PULSE_MAX_AGE_MS,
  REALERT_MS,
  type HeartbeatStream,
} from './thresholds'
import type { Incident, IncidentMap } from './incidents'

/**
 * Pure evaluation: observations in, stream verdicts and notification
 * decisions out. No I/O here, so the state machine can be reasoned about (and
 * tested) without a database or a Telegram token.
 */

export type CheckStatus = 'ok' | 'stale' | 'unknown'

export interface Observation {
  /** Stable incident key. */
  key: string
  /** Human name for the alert text. */
  label: string
  /** What is being watched, quoted in the alert so it is reproducible. */
  source: string
  /** Newest evidence seen. null = the read succeeded but found nothing. */
  seenAt: string | null
  /** The threshold this observation is judged against. */
  thresholdMs: number
  /** Why the threshold is what it is. */
  rationale: string
  /**
   * Set when the read itself failed. A failed read is NOT a stale stream —
   * it is an absence of measurement, and it gets its own status so a broken
   * monitor is never reported as a healthy service (or as a dead one).
   */
  readError?: string
}

export interface StreamVerdict extends Observation {
  status: CheckStatus
  /** Silence in ms, or null when there is nothing to measure from. */
  silentForMs: number | null
}

export type NotificationKind = 'alert' | 'reminder' | 'recovery'

export interface Notification {
  kind: NotificationKind
  verdict: StreamVerdict
  /** The incident this message is about — its open time, its last ping. */
  incident: Incident
}

export interface Evaluation {
  verdicts: StreamVerdict[]
  notifications: Notification[]
  /** The incident map to persist after this run. */
  nextIncidents: IncidentMap
}

/** Build the observation list for the three heartbeat streams. */
export function heartbeatObservations(
  beats: Record<string, { seenAt: string | null; readError?: string }>,
): Observation[] {
  return HEARTBEAT_STREAMS.map((s: HeartbeatStream) => ({
    key: s.key,
    label: s.label,
    source: `capture_health service='${s.service}'`,
    seenAt: beats[s.key]?.seenAt ?? null,
    thresholdMs: s.staleMs,
    rationale: s.rationale,
    readError: beats[s.key]?.readError,
  }))
}

/** Build the observations for the two data-liveness signals. */
export function dataLivenessObservations(input: {
  newestFillAt: string | null
  fillsReadError?: string
  pulseComputedAt: string | null
  pulseReadError?: string
}): Observation[] {
  return [
    {
      key: 'fills',
      label: 'fill capture',
      source: 'fills.timestamp (newest row)',
      seenAt: input.newestFillAt,
      thresholdMs: FILLS_MAX_AGE_MS,
      rationale: 'Hyperliquid never closes; no hour in the last 721 had zero fills',
      readError: input.fillsReadError,
    },
    {
      key: 'pulse',
      label: 'pulse_24h refresh',
      source: 'pulse_24h.computed_at',
      seenAt: input.pulseComputedAt,
      thresholdMs: PULSE_MAX_AGE_MS,
      rationale: 'pg_cron refreshes every 30m; 90m = three missed refreshes',
      readError: input.pulseReadError,
    },
  ]
}

/** Every incident key this monitor can ever open. */
export const ALL_STREAM_KEYS: string[] = [
  ...HEARTBEAT_STREAMS.map(s => s.key),
  'fills',
  'pulse',
  'database',
]

/**
 * Collapse a total read failure into one incident.
 *
 * When every read fails the cause is the database, not five simultaneous
 * service deaths — and saying it five times describes one outage badly while
 * costing five messages to do it. Partial failures are NOT folded: those are
 * genuinely per-stream and each deserves its own line.
 *
 * `database` is always present in the observation list (healthy when any read
 * succeeded) so that its recovery is observed and announced like any other.
 */
export function foldReadFailures(observations: Observation[], checkedAt: string): Observation[] {
  const allFailed = observations.length > 0 && observations.every(o => o.readError)
  const database: Observation = {
    key: 'database',
    label: 'monitor database reads',
    source: 'Supabase reads behind every check',
    seenAt: allFailed ? null : checkedAt,
    thresholdMs: 0,
    rationale: 'every read this run failed — one outage, not five',
    readError: allFailed ? observations[0].readError : undefined,
  }
  return allFailed ? [database] : [...observations, database]
}

function judge(obs: Observation, now: number): StreamVerdict {
  if (obs.readError) {
    return { ...obs, status: 'unknown', silentForMs: null }
  }
  if (obs.seenAt === null) {
    // The read worked and returned nothing. That is not zero silence and it
    // is not a healthy stream — there is simply no beat on record.
    return { ...obs, status: 'unknown', silentForMs: null }
  }
  const seen = Date.parse(obs.seenAt)
  if (Number.isNaN(seen)) {
    return { ...obs, status: 'unknown', silentForMs: null }
  }
  const silentForMs = now - seen
  return {
    ...obs,
    status: silentForMs > obs.thresholdMs ? 'stale' : 'ok',
    silentForMs,
  }
}

/**
 * Run the incident state machine over the observations.
 *
 * `unknown` is deliberately treated as failing: a stream we cannot measure is
 * a stream we cannot vouch for, and the whole point of this monitor is that
 * an absence of evidence never reads as evidence of health. It carries its
 * own message text so a read failure is never reported as a dead service.
 */
export function evaluate(
  observations: Observation[],
  open: IncidentMap,
  now: number = Date.now(),
): Evaluation {
  const verdicts = observations.map(o => judge(o, now))
  const notifications: Notification[] = []
  const nextIncidents: IncidentMap = {}
  const nowIso = new Date(now).toISOString()

  for (const verdict of verdicts) {
    const existing = open[verdict.key]
    const failing = verdict.status !== 'ok'

    if (!failing) {
      if (existing) {
        notifications.push({ kind: 'recovery', verdict, incident: existing })
      }
      continue // incident closed; nothing carried forward
    }

    if (!existing) {
      const incident: Incident = {
        openedAt: nowIso,
        lastSeenAt: verdict.seenAt,
        lastNotifiedAt: nowIso,
      }
      nextIncidents[verdict.key] = incident
      notifications.push({ kind: 'alert', verdict, incident })
      continue
    }

    // Still down. Stay quiet unless the reminder interval has elapsed.
    if (now - Date.parse(existing.lastNotifiedAt) >= REALERT_MS) {
      const incident: Incident = { ...existing, lastNotifiedAt: nowIso }
      nextIncidents[verdict.key] = incident
      notifications.push({ kind: 'reminder', verdict, incident })
    } else {
      nextIncidents[verdict.key] = existing
    }
  }

  // A key that is not in this run's observations was folded away (a total
  // read failure hides the five per-stream checks behind one `database`
  // incident). Carry its incident forward untouched: dropping it would
  // re-alert the moment reads came back, and closing it would claim a
  // recovery nothing observed. Keys that are no longer monitored at all are
  // pruned so state cannot grow forever.
  const observed = new Set(observations.map(o => o.key))
  for (const key of ALL_STREAM_KEYS) {
    if (!observed.has(key) && open[key]) nextIncidents[key] = open[key]
  }

  return { verdicts, notifications, nextIncidents }
}

/** Did the incident map change in a way worth persisting? */
export function incidentsChanged(before: IncidentMap, after: IncidentMap): boolean {
  return JSON.stringify(before) !== JSON.stringify(after)
}
