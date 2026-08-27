import type { SupabaseClient } from '@supabase/supabase-js'
import { getRedis } from '@/lib/cache/redis'

/**
 * Incident state for the external monitor.
 *
 * The monitor runs stateless every 15 minutes, so "alert once per incident"
 * needs somewhere to remember that an incident is already open. Two backends,
 * in preference order:
 *
 *  1. Upstash Redis — preferred, because it is the one store that survives
 *     the database itself being unreachable. That matters: "cannot read
 *     Supabase" is an incident this monitor must be able to report exactly
 *     once, and it cannot dedup that in Supabase.
 *  2. `capture_health` rows tagged `service='monitor'` — the fallback when
 *     Redis is not configured. No schema change: the table already carries a
 *     free-text `note`, the state map lives there as JSON, and every existing
 *     reader filters on `service` (`/api/capture/health`, `/api/pulse` both
 *     pin `service='capture'`), so a new label is invisible to them.
 *
 * Which backend actually ran is reported in the route's response rather than
 * assumed, and the fallback's one blind spot — it cannot dedup an alert about
 * the database being down, because writing the dedup record needs the same
 * database — is stated in `degraded`, not hidden.
 */

export interface Incident {
  /** When the stream first failed its check. */
  openedAt: string
  /** Last beat seen at the moment the incident opened (null = never seen). */
  lastSeenAt: string | null
  /** When we last sent a message about this incident. */
  lastNotifiedAt: string
}

export type IncidentMap = Record<string, Incident>

export interface IncidentStore {
  backend: 'redis' | 'capture_health'
  /** True when this backend cannot dedup a database-unreachable alert. */
  degraded: boolean
  load(): Promise<IncidentMap>
  /**
   * Persist incident state. A no-op for the `capture_health` backend: the run
   * record written every run already carries `open`, and a second row would
   * only be a second chance to disagree with itself.
   */
  save(map: IncidentMap): Promise<void>
}

/** What one monitor run leaves behind, as `capture_health.note` JSON. */
export interface MonitorRun {
  /** When the check ran. */
  ran: string
  healthy: boolean
  /** Which incident store was in use. */
  store: string
  /** Open incidents after this run — also the state the fallback reads back. */
  open: IncidentMap
  /** Whether the alert bot is configured at all on this deployment. */
  telegram: string
  /**
   * Messages this run tried to send, omitted when it tried none. `error` is
   * carried for undelivered ones: a failure recorded without its reason is
   * half a record, and the half it keeps is the half you cannot act on.
   */
  sent?: Array<{ stream: string; kind: string; delivered: boolean; messageId?: number; error?: string }>
}

const REDIS_KEY = 'alphalens:monitor:incidents'
const MONITOR_SERVICE = 'monitor'

/** Drop anything that is not a well-formed incident record. */
function parseMap(raw: unknown): IncidentMap {
  if (!raw || typeof raw !== 'object') return {}
  const out: IncidentMap = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const v = value as Partial<Incident> | null
    if (!v || typeof v !== 'object') continue
    if (typeof v.openedAt !== 'string' || typeof v.lastNotifiedAt !== 'string') continue
    out[key] = {
      openedAt: v.openedAt,
      lastSeenAt: typeof v.lastSeenAt === 'string' ? v.lastSeenAt : null,
      lastNotifiedAt: v.lastNotifiedAt,
    }
  }
  return out
}

function redisStore(): IncidentStore | null {
  const redis = getRedis()
  if (!redis) return null
  return {
    backend: 'redis',
    degraded: false,
    async load() {
      // @upstash/redis JSON-decodes on the way out; a string comes back when
      // the value was written by an older client.
      const raw = await redis.get<unknown>(REDIS_KEY)
      return parseMap(typeof raw === 'string' ? JSON.parse(raw) : raw)
    },
    async save(map) {
      await redis.set(REDIS_KEY, JSON.stringify(map))
    },
  }
}

function captureHealthStore(supabase: SupabaseClient): IncidentStore {
  return {
    backend: 'capture_health',
    degraded: true,
    async load() {
      const { data, error } = await supabase
        .from('capture_health')
        .select('note')
        .eq('service', MONITOR_SERVICE)
        .order('ts', { ascending: false })
        .limit(1)
      if (error) throw new Error(`incident state read: ${error.message}`)
      const note = data?.[0]?.note
      if (typeof note !== 'string' || note.length === 0) return {}
      try {
        return parseMap(JSON.parse(note).open)
      } catch {
        // A malformed note is treated as "no open incidents". That errs
        // towards alerting again rather than towards silence.
        return {}
      }
    },
    // The run record is the state row for this backend — see `save` above.
    async save() {},
  }
}

/**
 * Write the run record: one `capture_health` row per run, tagged
 * `service='monitor'`, so "did the monitor actually run" is a question the
 * database can answer. Existing readers pin `service='capture'`, so this label
 * is invisible to them, and no schema changed to hold it.
 */
export async function writeMonitorRun(supabase: SupabaseClient, run: MonitorRun): Promise<void> {
  const { error } = await supabase.from('capture_health').insert({
    service: MONITOR_SERVICE,
    note: JSON.stringify(run),
  })
  if (error) throw new Error(`monitor run record: ${error.message}`)
}

/** Redis when configured, `capture_health` otherwise. */
export function getIncidentStore(supabase: SupabaseClient): IncidentStore {
  return redisStore() ?? captureHealthStore(supabase)
}
