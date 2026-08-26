/**
 * Famous Replays — the curated gallery manifest.
 *
 * Entries live in content/famous-replays.json, committed to the repo so every
 * curated story is reviewable in git — not a database table someone can edit
 * out of band. Each entry pins one wallet + coin + episode window + interval
 * to exactly the replay-doc parameters the player requests, so the doc the
 * pre-builder warms is byte-for-byte the doc a visitor's card opens.
 *
 * Honesty contract (CLAUDE.md): every number in an entry was verified against
 * real fills before it shipped — the `verified` block says when and how, and
 * `pnl_usd` is the sum of the exchange's own closedPnl over the pinned
 * window's fills, never a headline repeated from a news story. Public-episode
 * claims carry their sources; a story that could not be verified from fills
 * does not appear here at all.
 */

import raw from '@/content/famous-replays.json'
import { parseRangeKey } from './docspec'
import { INTERVAL_MS } from './ladder'

export interface FamousReplay {
  /** URL identity: /replay/famous/<slug>. */
  slug: string
  title: string
  /** One-sentence story — what happened, no embellishment. */
  story: string
  /** 'autopsy' = from our copy-trading research; 'public' = a public episode. */
  source: 'autopsy' | 'public'
  address: string
  /** Pinned replay-doc request — must match the doc cache key exactly. */
  coin: string
  range: string
  interval: string
  /** The resolved bar width the pinned doc plays at, for display ("1h bars"). */
  bar_width: string
  /** The replayed window, ISO, for display. */
  window: { from: string; to: string }
  /** Net realized PnL over the pinned window, USD — sum of the exchange's own
   *  closedPnl figures over the window's fills. Negative = loss. */
  pnl_usd: number
  /** What pnl_usd is, stated next to it wherever it renders. */
  pnl_basis: string
  /** Honest coverage: which data window we can actually serve, and its source. */
  coverage_note: string
  /** When and how the entry was verified against real fills. */
  verified: { at: string; method: string }
  /** Public entries: where the story was reported. Autopsy entries: our page. */
  sources: string[]
  /** Autopsy entries link back to the research post. */
  research_href?: string
}

interface ManifestFile {
  entries: FamousReplay[]
}

function validate(entries: FamousReplay[]): FamousReplay[] {
  const seen = new Set<string>()
  for (const e of entries) {
    if (!/^[a-z0-9-]{3,64}$/.test(e.slug)) throw new Error(`famous: bad slug ${e.slug}`)
    if (seen.has(e.slug)) throw new Error(`famous: duplicate slug ${e.slug}`)
    seen.add(e.slug)
    if (!/^0x[0-9a-f]{40}$/.test(e.address))
      throw new Error(`famous ${e.slug}: address must be lowercase 0x + 40 hex`)
    if (!parseRangeKey(e.range)) throw new Error(`famous ${e.slug}: bad range ${e.range}`)
    if (e.interval !== 'auto' && !INTERVAL_MS[e.interval])
      throw new Error(`famous ${e.slug}: bad interval ${e.interval}`)
    if (e.coin && !/^[A-Za-z0-9@:_.-]{1,32}$/.test(e.coin))
      throw new Error(`famous ${e.slug}: bad coin ${e.coin}`)
    if (!Number.isFinite(e.pnl_usd)) throw new Error(`famous ${e.slug}: pnl_usd not a number`)
    if (!e.verified?.at || !e.verified?.method)
      throw new Error(`famous ${e.slug}: missing verification block`)
    if (e.source === 'autopsy' && !e.research_href)
      throw new Error(`famous ${e.slug}: autopsy entries must link the research post`)
  }
  return entries
}

const MANIFEST: FamousReplay[] = validate((raw as ManifestFile).entries)

export function listFamousReplays(): FamousReplay[] {
  return MANIFEST
}

export function famousBySlug(slug: string): FamousReplay | null {
  return MANIFEST.find(e => e.slug === slug) ?? null
}

/** Does a doc request match a curated entry? Used by the doc route to pin the
 *  cached doc: a curated episode is closed history — its fills are immutable
 *  facts — so the cache never expires for it. Rebuilding could only lose
 *  data once the exchange's sliding ~10K-fill window moves past the episode. */
export function famousPin(
  address: string,
  coin: string,
  range: string,
  interval: string
): FamousReplay | null {
  const addr = address.toLowerCase()
  return (
    MANIFEST.find(
      e => e.address === addr && e.coin === coin && e.range === range && e.interval === interval
    ) ?? null
  )
}
