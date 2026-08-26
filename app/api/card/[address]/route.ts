import { NextRequest, NextResponse } from 'next/server'
import { validateAddress } from '@/lib/validation'
import { buildReportCard, CARD_SCHEMA } from '@/lib/wallet-data/card'
import { schemaJson, CORS_HEADERS } from '@/lib/ledger/api'

// Public JSON behind /card/[address] — the same builder the page and the OG
// image render from, versioned card.v0. Fields may be added over time but
// existing ones are never renamed or removed. Null means "not measurable
// from the covered data", never zero.

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { address: string } }) {
  const address = validateAddress(params.address)
  if (!address) {
    return NextResponse.json(
      { error: 'Invalid address: expected 0x followed by 40 hex characters' },
      { status: 400, headers: CORS_HEADERS }
    )
  }
  try {
    const card = await buildReportCard(address)
    return schemaJson(CARD_SCHEMA, card as unknown as Record<string, unknown>)
  } catch {
    return NextResponse.json(
      { error: 'Could not build the report card just now — the data sources did not answer' },
      { status: 503, headers: CORS_HEADERS }
    )
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}
