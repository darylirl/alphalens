import { NextRequest, NextResponse } from 'next/server'
import { isAuthorized, unauthorizedResponse } from '@/lib/auth/admin'
import { buildCohortSignalPreview, publishCohortSignalFromConsole } from '@/lib/admin/cohort-signal'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/cohort-signal — publish one forward-looking Ledger call.
 *
 * Two irreversible effects, in one request: an append-only `ledger_calls` row
 * that no code path can edit, and a public post to the Ledger's Telegram
 * channel. There is no undo, so this route re-validates from scratch rather
 * than trusting that the caller previewed anything.
 *
 * The `confirm: true` field is required. It is not ceremony — this endpoint is
 * reachable by anything holding the admin token, and a publish must never be
 * the accidental result of a replayed or mistyped request.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return unauthorizedResponse()

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 })
  }

  if (body.confirm !== true) {
    return NextResponse.json(
      { error: 'confirm must be true — publishing writes an append-only row and posts publicly' },
      { status: 400 },
    )
  }

  const input = {
    coin: String(body.coin ?? ''),
    direction: String(body.direction ?? ''),
    confidence: Number(body.confidence),
    horizonHours: Number(body.horizon_hours ?? 24),
  }

  try {
    // Re-check before writing. The form gates its own button, but the button
    // is not the guard — this is, because the row cannot be taken back.
    const preview = await buildCohortSignalPreview(input)
    if (!preview.scoreable.ok) {
      return NextResponse.json({
        error: 'the scorer cannot read this subject — publishing it would resolve '
          + 'unresolvable permanently, in a table that forbids correction',
        errors: preview.scoreable.errors,
      }, { status: 400 })
    }
    if (!preview.ok) {
      return NextResponse.json({ error: 'not publishable', errors: preview.errors }, { status: 400 })
    }

    const out = await publishCohortSignalFromConsole(input)
    if (!out.published) {
      return NextResponse.json({ error: 'not published', errors: out.reasons ?? [] }, { status: 409 })
    }
    return NextResponse.json({ call: out.call }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
