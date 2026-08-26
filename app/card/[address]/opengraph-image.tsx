import { ImageResponse } from 'next/og'
import { validateAddress } from '@/lib/validation'
import { buildReportCard, type Grade } from '@/lib/wallet-data/card'
import { loadWalletFills } from '@/lib/wallet-data/fills'
import { detectEpisodes, bestAcrossCoins } from '@/lib/replay/episodes'
import { EpisodeEndCardBody, type OgEpisode } from '@/lib/replay/og-episode'
import type { RFill } from '@/lib/replay/engine'
import type { Fill } from '@/lib/hyperliquid/types'

// OG share image for the Wallet Report Card — an episode end-card frame: the
// wallet's largest-|PnL| round trip (same fills path and episode detector as
// the replay), with the overall grade beside it when the wallet clears the
// grading floor. Node runtime; the honest empty state renders when no round
// trip completed in the covered fills.

export const alt = 'AlphaLens Wallet Report Card — episode end card'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const GRADE_COLORS: Record<Grade, string> = {
  A: '#34EAB9',
  B: '#4ADE80',
  C: '#F5A623',
  D: '#FB923C',
  F: '#FF3B5C',
}

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
  let grade: Grade | null = null
  if (address) {
    try {
      const data = await loadWalletFills(address)
      const byCoin = new Map<string, Fill[]>()
      for (const f of data.fills) {
        const held = byCoin.get(f.coin)
        if (held) held.push(f)
        else byCoin.set(f.coin, [f])
      }
      best = bestAcrossCoins(
        [...byCoin.entries()].map(([coin, fills]) => ({
          coin,
          episodes: detectEpisodes(fills.map(toRFill)),
        }))
      )
      note = data.coverage.note
      label = data.wallet?.label ?? null
    } catch {
      note = 'data sources did not answer'
    }
    try {
      const card = await buildReportCard(address)
      grade = card.grades.gradeable ? (card.grades.overall ?? null) : null
    } catch {
      grade = null
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
            AlphaLens Report Card
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
          {grade && (
            <div
              style={{
                marginLeft: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                border: `2px solid ${GRADE_COLORS[grade]}`,
                borderRadius: 10,
                padding: '6px 18px',
              }}
            >
              <div
                style={{
                  color: 'rgba(240,250,248,0.55)',
                  fontSize: 18,
                  display: 'flex',
                  letterSpacing: 2,
                }}
              >
                OVERALL
              </div>
              <div
                style={{
                  color: GRADE_COLORS[grade],
                  fontSize: 36,
                  fontWeight: 700,
                  display: 'flex',
                }}
              >
                {grade}
              </div>
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
