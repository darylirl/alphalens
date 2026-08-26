import { ImageResponse } from 'next/og'
import { validateAddress } from '@/lib/validation'
import { loadWalletFills } from '@/lib/wallet-data/fills'

// OG share image for the replay — also the honest fallback where in-browser
// clip export is unsupported. Node runtime (reads our store for cohort
// wallets), same data path as the player's meta endpoint.

export const alt = 'AlphaLens Trade Replay'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

function shortAddr(a: string): string {
  return `${a.slice(0, 8)}…${a.slice(-6)}`
}

export default async function Image({ params }: { params: { address: string } }) {
  const address = validateAddress(params.address)
  let coins: { coin: string; fills: number }[] = []
  let note = 'wallet not found'
  let label: string | null = null
  let cohort = false
  if (address) {
    try {
      const data = await loadWalletFills(address)
      const byCoin = new Map<string, number>()
      for (const f of data.fills) byCoin.set(f.coin, (byCoin.get(f.coin) ?? 0) + 1)
      coins = [...byCoin.entries()]
        .map(([coin, fills]) => ({ coin, fills }))
        .sort((a, b) => b.fills - a.fills)
        .slice(0, 4)
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
            AlphaLens Trade Replay
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ color: '#F0FAF8', fontSize: 44, fontWeight: 700, display: 'flex' }}>
            {address ? (label ? `${label} · ${shortAddr(address)}` : shortAddr(address)) : 'Trade replay'}
          </div>
          <div
            style={{
              color: 'rgba(240,250,248,0.6)',
              fontSize: 26,
              display: 'flex',
              maxWidth: 1040,
            }}
          >
            Real fills on real candles, at exchange-exact execution prices — not a mark-priced
            reconstruction.
          </div>
          {coins.length > 0 && (
            <div style={{ display: 'flex', gap: 16 }}>
              {coins.map(c => (
                <div
                  key={c.coin}
                  style={{
                    display: 'flex',
                    color: '#F5A623',
                    fontSize: 24,
                    fontWeight: 700,
                    backgroundColor: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.10)',
                    borderRadius: 10,
                    padding: '10px 20px',
                  }}
                >
                  {`${c.coin} · ${c.fills.toLocaleString()} fills`}
                </div>
              ))}
            </div>
          )}
        </div>

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
