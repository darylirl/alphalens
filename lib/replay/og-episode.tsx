/**
 * The episode end-card, as a 1200×630 share image — the same frame the
 * exported clip closes on: coin, period, net realized PnL big and
 * USD-explicit, the entries/exits/max-size recap, and honest caveats. Used by
 * both the replay and report-card OG images so a link preview shows the story
 * the page tells. Everything here is computed from real fills upstream; the
 * honest empty state renders when a wallet has no detectable round trips.
 */

import type { Episode } from './episodes'
import { signedUsdExact, usdCompact, dayStamp, durationLabel } from './format'

export interface OgEpisode {
  coin: string
  episode: Episode
}

const UP = '#34EAB9'
const DOWN = '#FF3B5C'

function periodLabel(from: number, to: number): string {
  return dayStamp(from) === dayStamp(to)
    ? `${dayStamp(from)} · ${new Date(from).toISOString().slice(11, 16)}–${new Date(to)
        .toISOString()
        .slice(11, 16)} UTC`
    : `${dayStamp(from)} – ${dayStamp(to)}`
}

export function episodeCaveat(e: Episode): string {
  if (e.openBeforeCoverage) return 'position opened before captured history — partial picture'
  if (e.openAtEnd) return 'position still open at the end of covered fills'
  return ''
}

/** The card body between header and footer rows. */
export function EpisodeEndCardBody({ best }: { best: OgEpisode | null }) {
  if (!best) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div style={{ color: '#F0FAF8', fontSize: 44, fontWeight: 700, display: 'flex' }}>
          No round-trip episodes in the covered fills
        </div>
        <div style={{ color: 'rgba(240,250,248,0.55)', fontSize: 24, display: 'flex' }}>
          An episode is the position leaving zero and returning to it — none completed in the
          data we hold for this wallet.
        </div>
      </div>
    )
  }
  const e = best.episode
  const caveat = episodeCaveat(e)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
        <div style={{ color: '#F5A623', fontSize: 44, fontWeight: 800, display: 'flex' }}>
          {best.coin}
        </div>
        <div style={{ color: 'rgba(240,250,248,0.6)', fontSize: 26, display: 'flex' }}>
          {periodLabel(e.from, e.to)} · largest episode
        </div>
      </div>
      <div
        style={{
          color: e.pnl >= 0 ? UP : DOWN,
          fontSize: 112,
          fontWeight: 800,
          display: 'flex',
          lineHeight: 1.05,
        }}
      >
        {signedUsdExact(e.pnl)}
      </div>
      <div
        style={{
          color: 'rgba(240,250,248,0.5)',
          fontSize: 22,
          fontWeight: 700,
          display: 'flex',
          letterSpacing: 2,
        }}
      >
        NET REALIZED PNL, USD · EXCHANGE FIGURES
      </div>
      <div style={{ color: 'rgba(240,250,248,0.65)', fontSize: 26, display: 'flex' }}>
        {`${e.entries} ${e.entries === 1 ? 'entry' : 'entries'} · ${e.exits} ${
          e.exits === 1 ? 'exit' : 'exits'
        } · max position ${usdCompact(e.maxPosUsd)} · ${durationLabel(e.to - e.from)}`}
      </div>
      {caveat ? (
        <div style={{ color: '#F5A623', fontSize: 22, display: 'flex' }}>{caveat}</div>
      ) : null}
    </div>
  )
}
