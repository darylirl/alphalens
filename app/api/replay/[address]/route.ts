import { NextRequest, NextResponse } from 'next/server'
import { validateAddress } from '@/lib/validation'
import { loadWalletFills } from '@/lib/wallet-data/fills'
import { schemaJson, CORS_HEADERS } from '@/lib/ledger/api'
import { detectEpisodes, summarize, type EpisodeSummary } from '@/lib/replay/episodes'
import { gapsByCoin, drawable } from '@/lib/wallet-data/gaps'
import type { RFill } from '@/lib/replay/engine'
import type { Fill } from '@/lib/hyperliquid/types'

// Replay metadata for a wallet: which coins it traded in the covered window,
// with per-coin fill counts, time spans and round-trip episode summaries,
// plus the coverage block naming the source (our capture store for cohort
// wallets, the exchange's recent window otherwise). The default coin/episode
// is the wallet's largest-|PnL| complete round trip — computed by the same
// episode detector the player runs in the browser. Versioned replay.v0.

export const dynamic = 'force-dynamic'

const REPLAY_SCHEMA = 'replay.v0'

function toRFill(f: Fill): RFill {
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
}

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

    const byCoin = new Map<string, Fill[]>()
    for (const f of fills) {
      const held = byCoin.get(f.coin)
      if (held) held.push(f)
      else byCoin.set(f.coin, [f])
    }
    const gapsPerCoin = gapsByCoin(fills)
    const coins = [...byCoin.entries()]
      .map(([coin, coinFills]) => {
        const episodes: EpisodeSummary = summarize(
          detectEpisodes(coinFills.map(toRFill), drawable(gapsPerCoin.get(coin) ?? []))
        )
        return {
          coin,
          fills: coinFills.length,
          from: coinFills[0].time,
          to: coinFills[coinFills.length - 1].time,
          episodes,
        }
      })
      .sort((a, b) => b.fills - a.fills)

    // The page opens on the wallet's largest-|PnL| episode: prefer coins whose
    // top episode is a complete round trip, then rank by |PnL|. A wallet with
    // no episodes anywhere falls back to the most-traded coin.
    const ranked = [...coins]
      .filter(c => c.episodes.top)
      .sort((a, b) => {
        const aPartial = a.episodes.top!.openBeforeCoverage || a.episodes.top!.openAtEnd
        const bPartial = b.episodes.top!.openBeforeCoverage || b.episodes.top!.openAtEnd
        if (aPartial !== bPartial) return aPartial ? 1 : -1
        return Math.abs(b.episodes.top!.pnl) - Math.abs(a.episodes.top!.pnl)
      })
    const defaultCoin = ranked[0]?.coin ?? coins[0]?.coin ?? null

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
      default_coin: defaultCoin,
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
