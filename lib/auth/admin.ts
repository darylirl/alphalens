import type { NextRequest } from 'next/server'
import { timingSafeEqual } from 'crypto'

export const ADMIN_COOKIE = 'alphalens_admin'

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/** The configured admin token, or null when auth is not enabled. */
export function getAdminToken(): string | null {
  return process.env.ADMIN_API_TOKEN || null
}

/** Constant-time check of a submitted token against the configured one. */
export function verifyToken(submitted: string): boolean {
  const token = getAdminToken()
  return token !== null && safeEqual(submitted, token)
}

/**
 * Authorize a mutating request. When ADMIN_API_TOKEN is not configured the
 * API runs in open mode (dev/local). When configured, the request must carry
 * the token as a Bearer header or in the httpOnly admin cookie.
 */
export function isAuthorized(req: NextRequest): boolean {
  const token = getAdminToken()
  if (!token) return true

  const header = req.headers.get('authorization')
  if (header?.startsWith('Bearer ') && safeEqual(header.slice(7), token)) {
    return true
  }

  const cookie = req.cookies.get(ADMIN_COOKIE)?.value
  if (cookie && safeEqual(cookie, token)) {
    return true
  }

  return false
}

export function unauthorizedResponse() {
  return Response.json(
    { error: 'Unauthorized — admin token required for this action' },
    { status: 401 }
  )
}
