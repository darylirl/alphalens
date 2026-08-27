import { NextRequest, NextResponse } from 'next/server'
import { isAuthorized, unauthorizedResponse } from '@/lib/auth/admin'
// The publishing rule and the channel formatter are imported, never restated.
// A preview built from a second copy of either would be a preview of something
// other than what gets written and broadcast.
import { cohortSignalCall, publishCohortSignal } from '@/verify-service/lib/publish.mjs'
import { formatCall, ledgerTelegramConfigured } from '@/verify-service/lib/telegram.mjs'
import { scoreableSubject } from '@/verify-service/lib/scorer.mjs'

export const dynamic = 'force-dynamic'

/** The id is the one value that genuinely does not exist until the insert. */
const ID_PLACEHOLDER = '<assigned on publish>'

interface Body {
  coin?: unknown
  direction?: unknown
  confidence?: unknown
  horizon_hours?: unknown
  snapshot?: unknown
  confirm?: unknown
}

/**
 * POST /api/ledger/publish-signal
 *
 * Two modes on one code path:
 *   confirm !== true  → preview: build the row, refuse to write anything.
 *   confirm === true  → publish: the same row, inserted and announced.
 *
 * The preview calls cohortSignalCall() — the same constructor publishing uses —
 * so a spec that previews cleanly is the spec that publishes, and every floor
 * (skew, notional, active wallets, participating wallets, concentration) is
 * enforced here on the server whatever the browser believes. The form's
 * checks are a courtesy to the operator; this is the gate.
 *
 * ledger_calls is append-only. There is no edit and no undo, and publishing
 * broadcasts to the public Telegram channel, so the write happens only on an
 * explicit second call carrying confirm: true.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return unauthorizedResponse()

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'request body must be JSON' }, { status: 400 })
  }

  const input = {
    coin: String(body.coin ?? ''),
    direction: body.direction === 'up' ? ('up' as const) : ('down' as const),
    confidence: Number(body.confidence),
    horizonHours: Number(body.horizon_hours),
    // publishedAt is the server's clock, not the client's: the entry instant
    // the scorer prices against must not be something a browser can choose.
    publishedAt: new Date().toISOString(),
    snapshot: body.snapshot as Record<string, unknown>,
  }

  // Scoreability first, by the scorer's own parser, so an unscoreable subject
  // is named as such rather than surfacing as a generic build failure.
  const subject = { scope: 'cohort', coin: input.coin, direction: input.direction }
  const scoreable = scoreableSubject(subject) as { ok: boolean; errors: string[] }

  let row: Record<string, unknown>
  try {
    row = cohortSignalCall(input) as Record<string, unknown>
  } catch (e) {
    return NextResponse.json(
      {
        publishable: false,
        scoreable: scoreable.ok,
        scoreable_errors: scoreable.errors ?? [],
        // cohortSignalCall throws one message listing every failure; split it
        // back out so the form can show them as a list.
        errors: String(e instanceof Error ? e.message : e)
          .replace(/^cohort_signal is not publishable:\s*/, '')
          .split('; '),
      },
      { status: 400 },
    )
  }

  const telegramPreview = formatCall({ ...row, id: ID_PLACEHOLDER })

  if (body.confirm !== true) {
    return NextResponse.json({
      publishable: true,
      scoreable: scoreable.ok,
      preview: {
        row,
        telegram: {
          text: telegramPreview,
          configured: ledgerTelegramConfigured(),
          id_placeholder: ID_PLACEHOLDER,
        },
      },
    })
  }

  try {
    const result = (await publishCohortSignal(input)) as {
      published: boolean
      call?: { id: number }
      reasons?: string[]
    }
    if (!result.published) {
      return NextResponse.json({ published: false, reasons: result.reasons ?? [] }, { status: 409 })
    }
    return NextResponse.json({
      published: true,
      call: result.call,
      permalink: `/ledger/${result.call?.id}`,
    }, { status: 201 })
  } catch (e) {
    return NextResponse.json(
      { published: false, error: e instanceof Error ? e.message : 'publish failed' },
      { status: 500 },
    )
  }
}
