import 'server-only'
import { getSupabase } from '@/lib/db/supabase'
import { shapePulseRow, type PulseCoin, type PulseRow } from '@/lib/pulse/shape'
// The publisher and the scorer's parser are IMPORTED, never restated. The
// console's job is to refuse a call the real code would refuse — a second
// implementation of "what is publishable" that drifted from these would let
// the form bless a row the scorer cannot resolve.
import { cohortSignalCall, publishCohortSignal } from '@/verify-service/lib/publish.mjs'
import { scoreableSubject } from '@/verify-service/lib/scorer.mjs'
import { formatCall } from '@/verify-service/lib/telegram.mjs'

/**
 * Publishing a cohort_signal is TWO irreversible acts in one click: an
 * append-only row that can never be edited, and a public Telegram post to
 * @alphalens_ledger. There is no undo for either. So the preview here renders
 * both artifacts from the same code that will produce them, and the publish
 * path re-derives everything server-side rather than trusting the form.
 *
 * The snapshot is re-read here on every preview and every publish. The client
 * never supplies the numbers a call is based on: if it could, someone could
 * publish a call whose stated basis was never a real reading of the tape, and
 * the provenance block would be a fiction that looked like a citation.
 */

export interface CohortSignalInput {
  coin: string
  direction: string
  confidence: number
  horizonHours: number
}

export interface CohortSignalPreview {
  ok: boolean
  /** Why it cannot be published. Empty when ok. */
  errors: string[]
  /** The scorer's own verdict on the subject, reported separately because a
   *  subject it cannot read is the one failure that is permanent after publish. */
  scoreable: { ok: boolean; errors: string[] }
  /** The exact ledger_calls row, or null when it could not be built. */
  row: Record<string, unknown> | null
  /** The exact Telegram post, with the id the database has not assigned yet. */
  telegram: { text: string; idPlaceholder: string } | null
  snapshot: (PulseCoin & { computedAt: string | null; live: boolean }) | null
}

/** The id a call does not have until the insert returns. */
const PREVIEW_ID = '<assigned on publish>'

interface ScoreableSubject { scope: 'cohort'; coin: string; direction: 'up' | 'down' }

/**
 * Narrow a subject to the shape the publisher accepts, by ASKING THE SCORER.
 * The predicate delegates to `scoreableSubject()` rather than testing the
 * strings itself, so the type-level guarantee here and the runtime guarantee
 * at resolution time come from the same function and cannot drift apart.
 */
function isScoreable(subject: { scope: 'cohort'; coin: string; direction: string })
  : subject is ScoreableSubject {
  return (scoreableSubject(subject) as { ok: boolean }).ok
}

/**
 * The current pulse snapshot for one coin, read server-side from the same
 * matview `/api/pulse` serves, and shaped by the same mapper.
 */
export async function readPulseSnapshot(coin: string) {
  const supabase = getSupabase()
  const [{ data: rows, error }, { data: latest }] = await Promise.all([
    // Bounded and keyed: one coin, one row. Never an unbounded select.
    supabase.from('pulse_24h').select('*').eq('coin', coin).limit(1),
    supabase.from('capture_health').select('ts')
      .eq('service', 'capture').order('ts', { ascending: false }).limit(1),
  ])
  if (error) throw new Error(`pulse_24h read failed: ${error.message}`)
  const row = (rows || [])[0] as PulseRow | undefined
  if (!row) return null

  const lastTs = latest?.[0]?.ts ? new Date(latest[0].ts).getTime() : null
  return {
    ...shapePulseRow(row),
    computedAt: row.computed_at ?? null,
    // Capture being live is part of the snapshot, not a footnote: a call read
    // off a stalled capture is a call about a window nobody was measuring.
    live: lastTs !== null && Date.now() - lastTs < 3 * 60 * 1000,
  }
}

/** The coin menu: every coin with captured 24h flow, richest first. */
export async function readPulseCoins(): Promise<PulseCoin[]> {
  const { data, error } = await getSupabase()
    .from('pulse_24h').select('*')
    .order('notional_24h', { ascending: false })
    .limit(60) // an intended cap, comfortably under PostgREST's silent ~1000
  if (error) throw new Error(`pulse_24h read failed: ${error.message}`)
  return ((data || []) as PulseRow[]).filter(r => Number(r.notional_24h) > 0).map(shapePulseRow)
}

/**
 * Build the preview. Never throws for a bad input — an unpublishable call is a
 * result to render, not an exception, because the form's whole job is to show
 * WHY something cannot be published before anyone clicks.
 */
export async function buildCohortSignalPreview(
  input: CohortSignalInput,
  { publishedAt = new Date().toISOString() }: { publishedAt?: string } = {},
): Promise<CohortSignalPreview> {
  // The scorer's parser runs first and is reported on its own. Every other
  // failure here is recoverable by editing the form; a subject the scorer
  // cannot read is the one that, once published, resolves 'unresolvable'
  // permanently in a table that forbids correction.
  const subject = { scope: 'cohort' as const, coin: input.coin, direction: input.direction }
  const scoreable = scoreableSubject(subject) as { ok: boolean; errors: string[] }

  let snapshot: Awaited<ReturnType<typeof readPulseSnapshot>> = null
  try {
    snapshot = await readPulseSnapshot(input.coin)
  } catch (e) {
    return {
      ok: false,
      errors: [(e as Error).message],
      scoreable,
      row: null,
      telegram: null,
      snapshot: null,
    }
  }
  if (!snapshot) {
    return {
      ok: false,
      errors: [`${input.coin} has no row in the current pulse snapshot — `
        + 'a coin with no captured 24h flow has no positioning to call'],
      scoreable,
      row: null,
      telegram: null,
      snapshot: null,
    }
  }

  const errors: string[] = []
  if (!snapshot.live) {
    errors.push('capture is not live — refusing to derive a call from a stalled snapshot')
  }

  let row: Record<string, unknown> | null = null
  try {
    // Guarded by the scorer's own parser: when it rejects the subject the
    // errors above are already the reason, and there is no row to preview.
    if (!isScoreable(subject)) throw new Error('cohort_signal is not publishable: '
      + scoreable.errors.join('; '))
    row = cohortSignalCall({
      coin: subject.coin,
      direction: subject.direction,
      confidence: input.confidence,
      publishedAt,
      horizonHours: input.horizonHours,
      snapshot,
    }) as Record<string, unknown>
  } catch (e) {
    // cohortSignalCall joins its reasons with '; ' after a fixed prefix.
    const msg = (e as Error).message.replace(/^cohort_signal is not publishable: /, '')
    errors.push(...msg.split('; '))
  }

  return {
    ok: errors.length === 0 && scoreable.ok && row !== null,
    errors,
    scoreable,
    row,
    // Rendered from the same formatter the publisher will use, so what is
    // previewed is what the channel receives — except the id, which only the
    // insert can assign, and which is labelled rather than invented.
    telegram: row
      ? { text: formatCall({ ...row, id: PREVIEW_ID }) as string, idPlaceholder: PREVIEW_ID }
      : null,
    snapshot,
  }
}

/**
 * Publish. Re-derives the row from a freshly-read snapshot inside
 * publishCohortSignal() rather than accepting the previewed one: between
 * preview and confirm the matview may have refreshed, and the call must cite
 * the reading it was actually published from.
 */
export async function publishCohortSignalFromConsole(input: CohortSignalInput) {
  const snapshot = await readPulseSnapshot(input.coin)
  if (!snapshot) throw new Error(`${input.coin} has no row in the current pulse snapshot`)
  if (!snapshot.live) throw new Error('capture is not live — refusing to publish from a stalled snapshot')

  const subject = { scope: 'cohort' as const, coin: input.coin, direction: input.direction }
  if (!isScoreable(subject)) {
    throw new Error('the scorer cannot read this subject: '
      + (scoreableSubject(subject) as { errors: string[] }).errors.join('; '))
  }

  return await publishCohortSignal({
    coin: subject.coin,
    direction: subject.direction,
    confidence: input.confidence,
    publishedAt: new Date().toISOString(),
    horizonHours: input.horizonHours,
    snapshot,
    analysis: { source: 'admin console /admin → Publish cohort signal' },
  }, { log: (m: string) => console.log('[cohort-signal]', m) }) as {
    published: boolean
    call?: Record<string, unknown>
    reasons?: string[]
  }
}
