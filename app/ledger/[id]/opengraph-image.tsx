import { ImageResponse } from 'next/og'
import { loadCall, callBadge } from '@/lib/ledger/calls'

// OG share image for one Ledger call. Every string on it comes from the
// call's own immutable row — nothing is invented for the share card.

export const alt = 'AlphaLens Ledger call'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const TONE_COLORS: Record<string, string> = {
  green: '#34EAB9',
  red: '#FF3B5C',
  amber: '#F5A623',
  gray: 'rgba(240,250,248,0.55)',
}

export default async function Image({ params }: { params: { id: string } }) {
  const id = Number(params.id)
  const call = Number.isInteger(id) && id > 0 ? await loadCall(id) : null

  const badge = call ? callBadge(call) : { label: 'LEDGER', tone: 'gray' as const }
  const color = TONE_COLORS[badge.tone]
  const claim = call
    ? call.claim.length > 220 ? `${call.claim.slice(0, 217)}…` : call.claim
    : 'Call not found'
  const meta: string[] = []
  if (call) {
    meta.push(`Published ${call.published_at.slice(0, 10)}`)
    if (call.confidence !== null) meta.push(`Confidence ${Math.round(call.confidence * 100)}%`)
    if (call.scored_brier !== null && call.scored_brier !== undefined) {
      meta.push(`Brier ${Number(call.scored_brier).toFixed(3)}`)
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
          padding: 64,
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: '#34EAB9', display: 'flex' }} />
          <div style={{ color: '#F0FAF8', fontSize: 28, fontWeight: 700, display: 'flex' }}>
            AlphaLens Ledger{call ? ` · call #${call.id}` : ''}
          </div>
          <div
            style={{
              marginLeft: 'auto',
              color,
              border: `2px solid ${color}`,
              borderRadius: 8,
              padding: '6px 18px',
              fontSize: 24,
              fontWeight: 700,
              display: 'flex',
              textTransform: 'uppercase',
              letterSpacing: 2,
            }}
          >
            {badge.label}
          </div>
        </div>

        <div style={{ color: '#F0FAF8', fontSize: 38, fontWeight: 700, lineHeight: 1.3, display: 'flex', maxWidth: 1040 }}>
          {claim}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          {meta.map((m) => (
            <div
              key={m}
              style={{
                display: 'flex',
                color: 'rgba(240,250,248,0.6)',
                fontSize: 22,
                backgroundColor: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.10)',
                borderRadius: 10,
                padding: '10px 20px',
              }}
            >
              {m}
            </div>
          ))}
          <div style={{ display: 'flex', marginLeft: 'auto', color: 'rgba(240,250,248,0.45)', fontSize: 20 }}>
            Append-only · scored against captured tape
          </div>
        </div>
      </div>
    ),
    size,
  )
}
