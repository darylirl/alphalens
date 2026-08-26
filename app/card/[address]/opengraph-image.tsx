import { ImageResponse } from 'next/og'
import { validateAddress } from '@/lib/validation'
import { buildReportCard, type ReportCard, type Grade } from '@/lib/wallet-data/card'

// OG share image for the Wallet Report Card — same pattern as the ledger
// permalinks (Node runtime: the builder reads Supabase), same builder as the
// page, so the shared image can never disagree with what the page shows.
// Below the grade floor it renders the honest "not enough history" panel.

export const alt = 'AlphaLens Wallet Report Card'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const GRADE_COLORS: Record<Grade, string> = {
  A: '#34EAB9',
  B: '#4ADE80',
  C: '#F5A623',
  D: '#FB923C',
  F: '#FF3B5C',
}

function fmtUsd(n: number): string {
  const abs = Math.abs(n)
  const v =
    abs >= 1e9
      ? `$${(abs / 1e9).toFixed(2)}B`
      : abs >= 1e6
        ? `$${(abs / 1e6).toFixed(2)}M`
        : abs >= 1e3
          ? `$${(abs / 1e3).toFixed(1)}K`
          : `$${Math.round(abs).toLocaleString()}`
  return `${n >= 0 ? '+' : '−'}${v}`
}

function shortAddr(a: string): string {
  return `${a.slice(0, 8)}…${a.slice(-6)}`
}

export default async function Image({ params }: { params: { address: string } }) {
  const address = validateAddress(params.address)
  let card: ReportCard | null = null
  if (address) {
    try {
      card = await buildReportCard(address)
    } catch {
      card = null
    }
  }

  const grades = card?.grades ?? null
  const pnl = card?.performance.all_time_pnl_usd ?? null

  const tiles: { label: string; grade: Grade | null }[] = [
    { label: 'PERFORMANCE', grade: grades?.performance ?? null },
    { label: 'BEHAVIOR', grade: grades?.behavior ?? null },
    { label: 'RISK', grade: grades?.risk ?? null },
  ]

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
              marginLeft: 'auto',
              color: 'rgba(240,250,248,0.6)',
              fontSize: 24,
              display: 'flex',
            }}
          >
            {card ? shortAddr(card.address) : 'wallet not found'}
          </div>
        </div>

        {grades && grades.gradeable ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                border: `3px solid ${grades.overall ? GRADE_COLORS[grades.overall] : 'rgba(255,255,255,0.2)'}`,
                borderRadius: 20,
                padding: '30px 50px',
              }}
            >
              <div
                style={{
                  color: grades.overall ? GRADE_COLORS[grades.overall] : '#F0FAF8',
                  fontSize: 140,
                  fontWeight: 700,
                  display: 'flex',
                  lineHeight: 1,
                }}
              >
                {grades.overall ?? '—'}
              </div>
              <div
                style={{
                  color: 'rgba(240,250,248,0.55)',
                  fontSize: 20,
                  display: 'flex',
                  marginTop: 10,
                  letterSpacing: 2,
                }}
              >
                OVERALL
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18, flex: 1 }}>
              {tiles.map(t => (
                <div
                  key={t.label}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    backgroundColor: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.10)',
                    borderRadius: 14,
                    padding: '16px 28px',
                  }}
                >
                  <div
                    style={{
                      color: 'rgba(240,250,248,0.6)',
                      fontSize: 24,
                      display: 'flex',
                      letterSpacing: 2,
                    }}
                  >
                    {t.label}
                  </div>
                  <div
                    style={{
                      color: t.grade ? GRADE_COLORS[t.grade] : 'rgba(240,250,248,0.4)',
                      fontSize: 44,
                      fontWeight: 700,
                      display: 'flex',
                    }}
                  >
                    {t.grade ?? '—'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <div style={{ color: '#F0FAF8', fontSize: 46, fontWeight: 700, display: 'flex' }}>
              Not enough history to grade
            </div>
            <div style={{ color: 'rgba(240,250,248,0.55)', fontSize: 26, display: 'flex' }}>
              {card
                ? `${card.grades.closed_round_trips} of ${card.grades.floor} resolved round trips in the covered window`
                : 'No card could be built for this address'}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          {pnl !== null && (
            <div
              style={{
                display: 'flex',
                color: pnl >= 0 ? '#34EAB9' : '#FF3B5C',
                fontSize: 30,
                fontWeight: 700,
                backgroundColor: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.10)',
                borderRadius: 10,
                padding: '10px 20px',
              }}
            >
              {`${fmtUsd(pnl)} all-time (exchange figure)`}
            </div>
          )}
          {card && (
            <div
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
              {card.coverage.source === 'store'
                ? 'graded from our capture store'
                : 'recent exchange window only'}
            </div>
          )}
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
