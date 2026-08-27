import { NextRequest, NextResponse } from 'next/server'
import { isAuthorized, unauthorizedResponse } from '@/lib/auth/admin'
import { buildCohortSignalPreview, readPulseCoins } from '@/lib/admin/cohort-signal'

export const dynamic = 'force-dynamic'

/**
 * GET  /api/admin/cohort-signal/preview — the coin menu, from pulse_24h.
 * POST /api/admin/cohort-signal/preview — the exact row and Telegram post a
 *   publish would produce, plus every reason it would be refused.
 *
 * Auth-gated despite being read-only: it is the dry run of a privileged,
 * irreversible action, and the console gates the whole surface rather than
 * inviting anyone to explore what publishing would look like.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return unauthorizedResponse()
  try {
    return NextResponse.json({ coins: await readPulseCoins() })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 })
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return unauthorizedResponse()
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 })
  }

  try {
    const preview = await buildCohortSignalPreview({
      coin: String(body.coin ?? ''),
      direction: String(body.direction ?? ''),
      confidence: Number(body.confidence),
      horizonHours: Number(body.horizon_hours ?? 24),
    })
    return NextResponse.json(preview)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
