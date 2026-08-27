import { NextResponse, type NextRequest } from 'next/server'
import { getAdminToken, isAuthorized, unauthorizedResponse } from '@/lib/auth/admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/admin/monitor-check — run the dead-man's monitor on demand.
 *
 * The monitor route is protected by CRON_SECRET, which is exactly what makes
 * it awkward to exercise by hand: triggering it from a terminal means having
 * the secret in a terminal. This runs it server-side instead, so the operator
 * gets a button and the secret never leaves Vercel.
 *
 * It deliberately calls `/api/monitor/heartbeats` over HTTP rather than
 * importing its logic: the point of the button is to prove that the thing the
 * cron actually invokes — the deployed route, its auth gate, its reads, its
 * Telegram send — works. An in-process shortcut would test a copy of the path
 * and leave the real one unverified, which is the failure this whole feature
 * exists to stop repeating.
 */

/** This deployment's own origin, from the proxy headers Vercel sets. */
function selfOrigin(req: NextRequest): string | null {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (!host) return null
  const proto = req.headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

export async function POST(req: NextRequest) {
  // Fails closed, and more strictly than the other admin APIs: those run open
  // when ADMIN_API_TOKEN is unset (the documented local/dev mode), but this
  // one hands the monitor its own cron secret and can fire real Telegram
  // alerts. An open-mode deployment with CRON_SECRET set would otherwise be a
  // public alert-spam handle that walks straight past the monitor's own gate.
  if (getAdminToken() === null) {
    return NextResponse.json(
      { error: 'ADMIN_API_TOKEN must be set before this control is available' },
      { status: 503 },
    )
  }
  if (!isAuthorized(req)) return unauthorizedResponse()

  const secret = process.env.CRON_SECRET || getAdminToken()
  if (!secret) {
    return NextResponse.json({ error: 'No CRON_SECRET or ADMIN_API_TOKEN configured' }, { status: 503 })
  }

  const origin = selfOrigin(req)
  if (!origin) {
    return NextResponse.json({ error: 'Could not determine this deployment origin' }, { status: 500 })
  }

  const url = `${origin}/api/monitor/heartbeats`
  const startedAt = Date.now()
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: 'no-store',
      redirect: 'manual',
    })
    const text = await res.text()

    let result: unknown = null
    try {
      result = JSON.parse(text)
    } catch {
      // A deployment behind Vercel Authentication answers the self-call with
      // an SSO redirect, not JSON. Name that specifically — "unexpected token
      // <" would send the reader hunting for a bug that is not there.
      const protectedByVercel = res.status >= 300 && res.status < 400
      return NextResponse.json({
        ok: false,
        status: res.status,
        durationMs: Date.now() - startedAt,
        error: protectedByVercel
          ? 'The monitor route answered with a redirect, not JSON — this deployment sits behind '
            + 'Vercel Authentication, which intercepts the server-side call. Run this on the '
            + 'production deployment, where the route is reachable.'
          : `The monitor route returned a non-JSON body (HTTP ${res.status}).`,
        bodyPreview: text.slice(0, 300),
      }, { status: 502 })
    }

    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      durationMs: Date.now() - startedAt,
      // Verbatim. The operator is here to read what the monitor said, not a
      // summary of it that could disagree with the alert that just went out.
      result,
    })
  } catch (e) {
    return NextResponse.json({
      ok: false,
      status: 0,
      durationMs: Date.now() - startedAt,
      error: e instanceof Error ? e.message : String(e),
    }, { status: 502 })
  }
}
