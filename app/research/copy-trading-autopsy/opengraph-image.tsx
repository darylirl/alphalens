import { ImageResponse } from 'next/og'

// Share image for the copy-trading autopsy. Numbers are the verified
// headline results from backtest_results/ — same honesty contract as the
// page itself.

export const runtime = 'edge'
export const alt = 'We replayed 28,000 smart money trades so you don’t have to'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function Image() {
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
          <div style={{ color: '#F0FAF8', fontSize: 28, fontWeight: 700, display: 'flex' }}>AlphaLens Research</div>
          <div
            style={{
              marginLeft: 'auto',
              color: '#FF3B5C',
              border: '2px solid #FF3B5C',
              borderRadius: 8,
              padding: '6px 18px',
              fontSize: 24,
              fontWeight: 700,
              display: 'flex',
              textTransform: 'uppercase',
              letterSpacing: 2,
            }}
          >
            Killed
          </div>
        </div>

        <div style={{ color: '#F0FAF8', fontSize: 58, fontWeight: 800, lineHeight: 1.15, display: 'flex', maxWidth: 1000 }}>
          We replayed 28,000 smart money trades so you don’t have to
        </div>

        <div style={{ display: 'flex', gap: 20 }}>
          {[
            { label: 'COPIED TRADES', value: '28,318', color: '#F0FAF8' },
            { label: 'NET RESULT', value: '−$9,704', color: '#FF3B5C' },
            { label: 'GROSS BEFORE FEES', value: '−$5,380', color: '#FF3B5C' },
          ].map((s) => (
            <div
              key={s.label}
              style={{
                display: 'flex',
                flexDirection: 'column',
                backgroundColor: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.10)',
                borderRadius: 14,
                padding: '22px 30px',
                flex: 1,
              }}
            >
              <div style={{ color: 'rgba(240,250,248,0.5)', fontSize: 20, letterSpacing: 1, display: 'flex' }}>{s.label}</div>
              <div style={{ color: s.color, fontSize: 44, fontWeight: 800, marginTop: 8, display: 'flex' }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  )
}
