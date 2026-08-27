import { NextRequest, NextResponse } from 'next/server'
import { cohortSignalCall, publishCohortSignal } from '@/verify-service/lib/publish.mjs'
import { fetchPulseCoin } from '@/verify-service/publish-cohort-signal.mjs'
import { priceAt, PRICE_SEARCH_MIN } from '@/verify-service/lib/scorer.mjs'
import { isAuthorized, unauthorizedResponse } from '@/lib/auth/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/admin/cohort-signal
 *   { coin, direction, confidence, horizon_hours?, confirm? }
 *
 * The browser form for what `verify-service/publish-cohort-signal.mjs` does
 * from a terminal, running the same four checks in the same order, from the
 * same modules:
 *
 *   1. the CURRENT pulse snapshot, fetched HERE — `fetchPulseCoin` from the
 *      CLI itself, not a copy of it. The form's own /api/pulse read populates
 *      the picker and nothing else: a browser-supplied snapshot is a number
 *      the operator could have edited, and the call's provenance has to record
 *      what the service saw, not what the page sent.
 *   2. capture must be live in that snapshot's coverage block — a call off a
 *      stale snapshot is a call over an unknown window.
 *   3. a tape preflight through the SCORER'S own `priceAt`: no captured print
 *      for this coin one search window back means the call could only ever
 *      resolve 'unresolvable'.
 *   4. `cohortSignalCall` / `publishCohortSignal` in publish.mjs — never a
 *      direct insert — which is where the scorer's `scoreableSubject()` runs
 *      on the exact subject, and where the direction, skew, wallet and
 *      notional floors are enforced.
 *
 * Without `confirm: true` this previews: every check runs and the row is
 * returned, unwritten. `published_at` and `resolves_at` are re-stamped at
 * confirm, because a call must not be backdated to whenever its preview was
 * rendered; the response says so rather than implying the timestamps are final.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return unauthorizedResponse()

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'request body must be JSON' }, { status: 400 })
  }

  const coin = typeof body.coin === 'string' ? body.coin.trim() : ''
  // Deliberately not narrowed here. `cohortSignalCall` runs the scorer's own
  // scoreableSubject() on the subject it builds, and that is the authority on
  // what a direction may be; a second check in this file could drift from it.
  const direction = body.direction as 'up' | 'down'
  const confidence = Number(body.confidence)
  const horizonHours = body.horizon_hours === undefined ? 24 : Number(body.horizon_hours)
  const confirm = body.confirm === true

  if (!coin) return NextResponse.json({ error: 'coin is required' }, { status: 400 })

  const pulseUrl = `${req.nextUrl.origin}/api/pulse`

  try {
    const snapshot = await fetchPulseCoin(coin, pulseUrl)

    if (!snapshot.coverage?.live) {
      return NextResponse.json({
        error: 'capture is not live in the pulse coverage block — refusing to call off a stale snapshot',
      }, { status: 409 })
    }

    // The scorer's own reader, one search window back. If there is no print
    // now there will be none at the horizon either.
    const probeMs = Date.now() - PRICE_SEARCH_MIN * 60_000
    const probe = await priceAt(coin, probeMs)
    if (!probe) {
      return NextResponse.json({
        error: `no captured price print for ${coin} within ${PRICE_SEARCH_MIN}m of `
          + `${new Date(probeMs).toISOString()} — this call could only resolve 'unresolvable'`,
      }, { status: 409 })
    }

    const input = {
      coin,
      direction,
      confidence,
      publishedAt: new Date().toISOString(),
      horizonHours,
      snapshot,
    }

    if (!confirm) {
      return NextResponse.json({
        preview: true,
        row: cohortSignalCall(input),
        tape_preflight: { source: probe.source, price: probe.price, ts: probe.ts },
        restamped_on_confirm: ['published_at', 'resolves_at'],
      })
    }

    const out = await publishCohortSignal(input, { log: () => {} })
    if (!out.published) {
      return NextResponse.json({ error: out.reasons?.join('; ') || 'not published' }, { status: 409 })
    }
    return NextResponse.json({ published: true, call: out.call }, { status: 201 })
  } catch (e) {
    // cohortSignalCall throws one Error listing every floor the call fails.
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
