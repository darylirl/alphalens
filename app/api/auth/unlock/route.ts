import { NextRequest, NextResponse } from 'next/server'
import { getAdminToken, isAuthorized, verifyToken, ADMIN_COOKIE } from '@/lib/auth/admin'

const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 // 30 days

/**
 * GET /api/auth/unlock
 * Reports whether admin auth is enabled and whether this request is authorized.
 */
export async function GET(req: NextRequest) {
  const locked = getAdminToken() !== null
  return NextResponse.json({ locked, authorized: isAuthorized(req) })
}

/**
 * POST /api/auth/unlock  { token }
 * Verifies the admin token and sets an httpOnly session cookie on success.
 */
export async function POST(req: NextRequest) {
  const configured = getAdminToken()
  if (!configured) {
    return NextResponse.json({ success: true, open: true })
  }

  let submitted = ''
  try {
    const body = await req.json()
    submitted = typeof body.token === 'string' ? body.token : ''
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!verifyToken(submitted)) {
    return NextResponse.json({ error: 'Invalid admin token' }, { status: 401 })
  }

  const res = NextResponse.json({ success: true })
  res.cookies.set(ADMIN_COOKIE, configured, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.ALLOW_INSECURE_COOKIE !== '1',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  })
  return res
}
