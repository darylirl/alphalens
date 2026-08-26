/**
 * Round-trip episodes, detected from a wallet's real fills.
 *
 * An episode is the position leaving zero and coming back to it — the unit a
 * viewer actually wants to watch, and the unit the replay opens on. Episodes
 * separated by less than MERGE_GAP_MS of flat time are one story told with a
 * pause, so they merge. Everything here is arithmetic on exchange-reported
 * fills (sizes, sides, start positions, closedPnl); nothing is mark-priced,
 * and a position we never saw open or close is flagged as partial rather than
 * dressed up as a round trip.
 *
 * Isomorphic on purpose: the meta API summarises episodes server-side to pick
 * the page's default, and the player detects the full list in the browser
 * from the same fills — one implementation, so they cannot disagree.
 */

import type { RFill } from './engine'

/** Flat gaps shorter than this merge two round trips into one episode. */
export const MERGE_GAP_MS = 10 * 60_000

export interface Episode {
  /** First and last fill timestamps of the episode, ms. */
  from: number
  to: number
  /** Sum of the exchange's own closedPnl over the episode's fills. */
  pnl: number
  /** Sum of exchange-reported fees. */
  fees: number
  /** Fills that grew the position / shrank it. A flip counts by its net effect. */
  entries: number
  exits: number
  fills: number
  /** Largest absolute position held, in coins. */
  maxPosCoins: number
  /** That position valued at the exchange price of the fill that set it —
   *  a real print, not a mark. */
  maxPosUsd: number
  /** The position predates the covered fills — we never saw it open, so the
   *  PnL and counts are a partial picture. */
  openBeforeCoverage: boolean
  /** The position outlives the covered fills — we never saw it close. */
  openAtEnd: boolean
  /** Indices into the fills array this episode spans (inclusive). */
  firstFill: number
  lastFill: number
}

/** |pos| below this fraction of the largest size seen is flat — float dust
 *  from summing exact decimal sizes, not a position. */
const FLAT_FRACTION = 1e-6

interface Walked {
  posBefore: number
  posAfter: number
}

/** Walk the fills once, preferring the exchange's own start_position where it
 *  is reported — it self-corrects float drift and tells us honestly when the
 *  history begins mid-position. */
function walkPositions(fills: RFill[]): Walked[] {
  const out: Walked[] = []
  let pos = 0
  for (const f of fills) {
    const before = f.start !== null && Number.isFinite(f.start) ? f.start : pos
    const delta = f.side === 'B' ? f.sz : -f.sz
    pos = before + delta
    out.push({ posBefore: before, posAfter: pos })
  }
  return out
}

export function detectEpisodes(fills: RFill[]): Episode[] {
  if (fills.length === 0) return []
  const walked = walkPositions(fills)

  let maxSz = 0
  for (const f of fills) maxSz = Math.max(maxSz, Math.abs(f.sz))
  for (const w of walked) maxSz = Math.max(maxSz, Math.abs(w.posAfter))
  const eps = Math.max(maxSz * FLAT_FRACTION, 1e-9)
  const flat = (p: number) => Math.abs(p) <= eps

  // Segments: maximal runs of fills over which the position is never flat
  // after a fill. A fill from flat is the segment's first; a fill back to
  // flat is its last. A flip stays inside its segment — the position crossed
  // zero but never rested there.
  interface Segment {
    first: number
    last: number
    openBefore: boolean
    openAfter: boolean
  }
  const segments: Segment[] = []
  let open: Segment | null = null
  for (let i = 0; i < fills.length; i++) {
    const w = walked[i]
    if (!open) {
      // A lone fill that starts flat and ends flat (a same-bar scratch the
      // exchange nets out) still forms a one-fill segment.
      open = { first: i, last: i, openBefore: !flat(w.posBefore), openAfter: false }
    }
    open.last = i
    if (flat(w.posAfter)) {
      segments.push(open)
      open = null
    }
  }
  if (open) {
    open.openAfter = true
    segments.push(open)
  }

  // Merge segments whose flat gap is under MERGE_GAP_MS.
  const merged: Segment[] = []
  for (const s of segments) {
    const prev = merged[merged.length - 1]
    if (prev && !prev.openAfter && fills[s.first].t - fills[prev.last].t < MERGE_GAP_MS) {
      prev.last = s.last
      prev.openAfter = s.openAfter
    } else {
      merged.push({ ...s })
    }
  }

  return merged.map(s => {
    let pnl = 0
    let fees = 0
    let entries = 0
    let exits = 0
    let maxPosCoins = 0
    let maxPosUsd = 0
    for (let i = s.first; i <= s.last; i++) {
      const f = fills[i]
      const w = walked[i]
      pnl += f.pnl
      fees += f.fee
      if (Math.abs(w.posAfter) > Math.abs(w.posBefore) + eps) entries++
      else exits++
      const absAfter = Math.abs(w.posAfter)
      if (absAfter > maxPosCoins) {
        maxPosCoins = absAfter
        maxPosUsd = absAfter * f.px
      }
    }
    return {
      from: fills[s.first].t,
      to: fills[s.last].t,
      pnl,
      fees,
      entries,
      exits,
      fills: s.last - s.first + 1,
      maxPosCoins,
      maxPosUsd,
      openBeforeCoverage: s.openBefore,
      openAtEnd: s.openAfter,
      firstFill: s.first,
      lastFill: s.last,
    }
  })
}

/** Episodes ordered for the picker: largest |PnL| first. */
export function byPnl(episodes: Episode[]): Episode[] {
  return [...episodes].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))
}

/**
 * The episode the page opens on: the largest-|PnL| COMPLETE round trip —
 * one we saw open and close. Only when no complete episode exists does a
 * partial one stand in (flagged, so the UI says so).
 */
export function defaultEpisode(episodes: Episode[]): Episode | null {
  const ranked = byPnl(episodes)
  return ranked.find(e => !e.openBeforeCoverage && !e.openAtEnd) ?? ranked[0] ?? null
}

/** The wallet's single best episode across coins — complete round trips
 *  first, then largest |PnL|. What the replay page opens on and what the
 *  share images frame. */
export function bestAcrossCoins(
  perCoin: { coin: string; episodes: Episode[] }[]
): { coin: string; episode: Episode } | null {
  let best: { coin: string; episode: Episode } | null = null
  const partial = (e: Episode) => e.openBeforeCoverage || e.openAtEnd
  for (const { coin, episodes } of perCoin) {
    for (const e of episodes) {
      if (!best) {
        best = { coin, episode: e }
        continue
      }
      const bp = partial(best.episode)
      const ep = partial(e)
      if (bp !== ep ? bp : Math.abs(e.pnl) > Math.abs(best.episode.pnl)) {
        best = { coin, episode: e }
      }
    }
  }
  return best
}

/** Compact per-coin summary for the meta API — enough to pick the page's
 *  default coin+episode without shipping every fill. */
export interface EpisodeSummary {
  count: number
  top: Pick<
    Episode,
    'from' | 'to' | 'pnl' | 'entries' | 'exits' | 'fills' | 'openBeforeCoverage' | 'openAtEnd'
  > | null
}

export function summarize(episodes: Episode[]): EpisodeSummary {
  const top = defaultEpisode(episodes)
  return {
    count: episodes.length,
    top: top
      ? {
          from: top.from,
          to: top.to,
          pnl: top.pnl,
          entries: top.entries,
          exits: top.exits,
          fills: top.fills,
          openBeforeCoverage: top.openBeforeCoverage,
          openAtEnd: top.openAtEnd,
        }
      : null,
  }
}
