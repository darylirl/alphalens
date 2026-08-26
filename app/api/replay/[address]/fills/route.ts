import { NextRequest, NextResponse } from 'next/server'
import { validateAddress } from '@/lib/validation'
import { loadWalletFills } from '@/lib/wallet-data/fills'
import { schemaJson, CORS_HEADERS } from '@/lib/ledger/api'

// One coin's fills for the replay, at exchange-exact execution prices: every
// row is a real fill (from our capture store for cohort wallets, live from
// the exchange otherwise) — price, size, side, direction and realized PnL as
// the exchange reported them. Nothing is mark-priced or reconstructed.

export const dynamic = 'force-dynamic'

const REPLAY_SCHEMA = 'replay.v0'

export async function GET(req: NextRequest, { params }: { params: { address: string } }) {
  const address = validateAddress(params.address)
  if (!address) {
    return NextResponse.json(
      { error: 'Invalid address: expected 0x followed by 40 hex characters' },
      { status: 400, headers: CORS_HEADERS }
    )
  }
  const coin = req.nextUrl.searchParams.get('coin')
  if (!coin || !/^[A-Za-z0-9@:_.-]{1,32}$/.test(coin)) {
    return NextResponse.json(
      { error: 'Pass ?coin= — one coin per request' },
      { status: 400, headers: CORS_HEADERS }
    )
  }
  try {
    const { fills, coverage, isCohort, gapCoins } = await loadWalletFills(address, { coin })
    const isGapCoin = gapCoins.includes(coin)
    return schemaJson(REPLAY_SCHEMA, {
      address: address.toLowerCase(),
      coin,
      coverage,
      /** True when captured history for this coin begins mid-position — the
       *  running PnL is then a partial picture and the replay says so. */
      starts_mid_position: isGapCoin,
      cohort_member: isCohort,
      fills: fills.map(f => {
        const start = parseFloat(f.startPosition)
        return {
          t: f.time,
          px: Number(f.px),
          sz: Number(f.sz),
          side: f.side,
          dir: f.dir,
          pnl: Number(f.closedPnl) || 0,
          fee: Number(f.fee) || 0,
          start: Number.isFinite(start) ? start : null,
        }
      }),
    })
  } catch {
    return NextResponse.json(
      { error: 'Could not load fills just now — the data sources did not answer' },
      { status: 503, headers: CORS_HEADERS }
    )
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}
