import { NextRequest, NextResponse } from 'next/server'
import { validateAddress } from '@/lib/validation'
import { loadWalletFills } from '@/lib/wallet-data/fills'
import { schemaJson, CORS_HEADERS } from '@/lib/ledger/api'

// Replay metadata for a wallet: which coins it traded in the covered window,
// with per-coin fill counts and time spans, plus the coverage block naming
// the source (our capture store for cohort wallets, the exchange's recent
// window otherwise). Versioned replay.v0.

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
  try {
    const { fills, coverage, isCohort, wallet, gapCoins } = await loadWalletFills(address)

    const byCoin = new Map<string, { fills: number; from: number; to: number }>()
    for (const f of fills) {
      const e = byCoin.get(f.coin)
      if (!e) byCoin.set(f.coin, { fills: 1, from: f.time, to: f.time })
      else {
        e.fills++
        if (f.time < e.from) e.from = f.time
        if (f.time > e.to) e.to = f.time
      }
    }
    const coins = [...byCoin.entries()]
      .map(([coin, e]) => ({ coin, ...e }))
      .sort((a, b) => b.fills - a.fills)

    return schemaJson(REPLAY_SCHEMA, {
      address: address.toLowerCase(),
      identity: {
        label: wallet?.label ?? null,
        archetype: wallet?.archetype ?? null,
        cohort_member: isCohort,
      },
      coverage,
      gap_coins: gapCoins,
      coins,
      default_coin: coins[0]?.coin ?? null,
    })
  } catch {
    return NextResponse.json(
      { error: 'Could not load replay metadata just now — the data sources did not answer' },
      { status: 503, headers: CORS_HEADERS }
    )
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}
