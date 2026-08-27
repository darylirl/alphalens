import { ImageResponse } from 'next/og'
import { validateAddress } from '@/lib/validation'
import { loadWalletFills } from '@/lib/wallet-data/fills'
import { detectEpisodes, bestAcrossCoins } from '@/lib/replay/episodes'
import { gapsByCoin, drawable } from '@/lib/wallet-data/gaps'
import { EpisodeEndCardBody, type OgEpisode } from '@/lib/replay/og-episode'
import type { RFill } from '@/lib/replay/engine'
import type { Fill } from '@/lib/hyperliquid/types'

// OG share image for the replay — an episode end-card frame: the wallet's
// largest-|PnL| round trip, exactly the story the replay opens on. Also the
// honest fallback where in-browser clip export is unsupported. Node runtime
// (reads our store for cohort wallets), same fills path and same episode
// detector as the player, so the shared image cannot disagree with the page.

export const alt = 'AlphaLens Trade Replay — episode end card'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

function shortAddr(a: string): string {
  return `${a.slice(0, 8)}…${a.slice(-6)}`
}

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

export default async function Image({ params }: { params: { address: string } }) {
  const address = validateAddress(params.address)
  let best: OgEpisode | null = null
  let note = 'wallet not found'
  let label: string | null = null
  let cohort = false
  if (address) {
    try {
      const data = await loadWalletFills(address)
      const byCoin = new Map<string, Fill[]>()
      for (const f of data.fills) {
        const held = byCoin.get(f.coin)
        if (held) held.push(f)
        else byCoin.set(f.coin, [f])
      }
      const gapsPerCoin = gapsByCoin(data.fills)
      best = bestAcrossCoins(
        [...byCoin.entries()].map(([coin, fills]) => ({
          coin,
          episodes: detectEpisodes(fills.map(toRFill), drawable(gapsPerCoin.get(coin) ?? [])),
        }))
      )
      note = data.coverage.note
      label = data.wallet?.label ?? null
      cohort = data.isCohort
    } catch {
      note = 'data sources did not answer'
    }
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: '#0F1A1E',
          padding: 56,
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 7,
              backgroundColor: '#34EAB9',
              display: 'flex',
            }}
          />
          <div style={{ color: '#F0FAF8', fontSize: 28, fontWeight: 700, display: 'flex' }}>
            AlphaLens Trade Replay
          </div>
          <div
            style={{
              color: 'rgba(240,250,248,0.6)',
              fontSize: 22,
              display: 'flex',
              marginLeft: 12,
            }}
          >
            {address ? (label ? `${label} · ${shortAddr(address)}` : shortAddr(address)) : ''}
          </div>
          {cohort && (
            <div
              style={{
                marginLeft: 'auto',
                color: '#34EAB9',
                border: '2px solid rgba(52,234,185,0.5)',
                borderRadius: 8,
                padding: '6px 18px',
                fontSize: 22,
                fontWeight: 700,
                display: 'flex',
                textTransform: 'uppercase',
                letterSpacing: 2,
              }}
            >
              cohort
            </div>
          )}
        </div>

        <EpisodeEndCardBody best={best} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <div
            style={{
              display: 'flex',
              color: 'rgba(240,250,248,0.6)',
              fontSize: 20,
              backgroundColor: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.10)',
              borderRadius: 10,
              padding: '10px 20px',
              maxWidth: 800,
            }}
          >
            {note}
          </div>
          <div
            style={{
              display: 'flex',
              marginLeft: 'auto',
              color: 'rgba(240,250,248,0.45)',
              fontSize: 20,
            }}
          >
            Not a recommendation · alphalens
          </div>
        </div>
      </div>
    ),
    size
  )
}
