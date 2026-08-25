import { NextResponse } from 'next/server'

// Copy-trade configuration endpoints are retired. Our own replay backtests
// (28,318 copied trades across two cohorts with real frictions) showed naive
// copy-trading loses money — gross was negative before fees. The product
// pivoted to verification-first research; see /learn for the full autopsy.
// 410 Gone: this is intentional removal, not an outage.

const GONE = {
  error: 'Copy-trade configuration has been retired.',
  reason:
    'Our own backtests (28,318 replayed trades with real delay, slippage, and fees) ' +
    'showed naive copy-trading loses money. AlphaLens pivoted to verification-first research.',
  see: '/learn',
}

export async function GET() {
  return NextResponse.json(GONE, { status: 410 })
}

export async function POST() {
  return NextResponse.json(GONE, { status: 410 })
}
