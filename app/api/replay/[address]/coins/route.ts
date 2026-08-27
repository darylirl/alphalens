import { NextRequest, NextResponse } from 'next/server'
import { validateAddress } from '@/lib/validation'
import { schemaJson, CORS_HEADERS } from '@/lib/ledger/api'
import { loadCoinMenu } from '@/lib/wallet-data/coin-menu'

// The replay coin menu (Replay v2.2): the page's FIRST paint. Which coins the
// wallet traded in the covered window — per-coin fill counts, spans, realized
// PnL, and a cumulative-PnL sparkline where the fills were already in hand —
// plus the coverage block naming the source (our capture store for cohort
// wallets, the exchange's ~10K-recent-fills window otherwise).
//
// Deliberately cheap: cohort wallets are ONE SQL aggregate (replay_coin_menu,
// migration 018), pasted wallets one exchange window read. No episode
// detection and no document building happen here — those are per-coin work
// and run only after a coin is chosen. Versioned replay-coins.v1.

export const dynamic = 'force-dynamic'

const SCHEMA = 'replay-coins.v1'

export async function GET(_req: NextRequest, { params }: { params: { address: string } }) {
  const address = validateAddress(params.address)
  if (!address) {
    return NextResponse.json(
      { error: 'Invalid address: expected 0x followed by 40 hex characters' },
      { status: 400, headers: CORS_HEADERS }
    )
  }
  try {
    const menu = await loadCoinMenu(address)
    return schemaJson(SCHEMA, {
      address: address.toLowerCase(),
      identity: {
        label: menu.wallet?.label ?? null,
        archetype: menu.wallet?.archetype ?? null,
        cohort_member: menu.isCohort,
      },
      coverage: menu.coverage,
      gap_coins: menu.gapCoins,
      coins_capped: menu.coinsCapped,
      coins: menu.coins,
    })
  } catch {
    return NextResponse.json(
      { error: 'Could not load the coin menu just now — the data sources did not answer' },
      { status: 503, headers: CORS_HEADERS }
    )
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}
