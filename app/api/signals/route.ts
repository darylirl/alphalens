import { NextResponse } from 'next/server'

// API stub for active signals and consensus alerts.
// In production this would query the WebSocket-fed signal pipeline.
export async function GET() {
  return NextResponse.json({
    signals: [],
    consensus: [],
  })
}
