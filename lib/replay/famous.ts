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
  /** Which tape the pinned episode comes from. Normally omitted — the loader's
   *  own rule decides (cohort wallets read our capture store, everyone else
   *  the exchange window). Set to 'exchange' when a curated episode lies
   *  OUTSIDE a cohort wallet's captured range: the wallet is capture_enabled,
   *  so the default rule would read the store and find nothing there.
   *
   *  This also makes the entry REPRODUCIBLE, which is not a hypothetical:
   *  the comeback entry's wallet entered capture scope the same day it was
   *  curated, and the daemon began backfilling it — our store for that wallet
   *  went from 63,903 fills ending 2026-06-29 to 79,579 ending 2026-07-23
   *  within six hours, and is still advancing toward the pinned episode.
   *  Without a pinned source, the tape answering a rebuild would depend on
   *  WHEN it ran. The coverage note must say which source and why.
   */
  fills_source?: 'store' | 'exchange'
  /**
   * Why this entry is not being served. An entry is withheld when its pinned
   * episode can no longer be reproduced from the fills its source serves
   * today — for instance when the served series turns out to contain a proven
   * capture gap, which splits the episode and leaves the entry's stated figure
   * describing a window the player no longer plays as one story.
   *
   * The entry STAYS in the file: it is an honest record of what was verified
   * and when, and deleting it to tidy the gallery would be its own dishonesty.
   * It is unpublished, not erased — the same rule the Ledger applies to
   * ineligible results (CLAUDE.md): filter on publish, never edit history.
   */
  withheld?: string
  /** A claim about this wallet we can NAME but have not verified from fills,
   *  with the reason and the path that would verify it. Rendered as an
   *  explicit not-verified note — never merged into any figure above. */
  pending_verification?: string
  /** When and how the entry was verified against real fills. */
  verified: { at: string; method: string }
  /** Public entries: where the story was reported. Autopsy entries: our page. */
  sources: string[]
  /** Autopsy entries link back to the research post. */
  research_href?: string
  /** Autopsy entries: the exact relationship between this replay and the
   *  research run, stated per entry. A research run is a separate measurement
   *  over a different window; an entry must never let its title, story or
   *  figure borrow the run's findings. */
  research_context?: string
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
    // An autopsy entry sits next to a published research run, which is a
    // DIFFERENT measurement over a DIFFERENT window. Without the relationship
    // spelled out, a title drifts into claiming the run's findings — which is
    // exactly how "The scalper you cannot copy" ended up labelling a −$503
    // day with run 1's −$1,251 verdict. The pairing is required, not optional.
    if (e.source === 'autopsy' && !e.research_context)
      throw new Error(
        `famous ${e.slug}: autopsy entries must state research_context — how this replay ` +
          `relates to the research run, so the title cannot borrow the run's findings`
      )
    if (e.fills_source && e.fills_source !== 'store' && e.fills_source !== 'exchange')
      throw new Error(`famous ${e.slug}: fills_source must be 'store' or 'exchange'`)
  }
  return entries
}

const MANIFEST: FamousReplay[] = validate((raw as ManifestFile).entries)

/** Everything in the file, withheld entries included. For tooling and audits
 *  — never for anything a visitor sees. */
export function allFamousReplays(): FamousReplay[] {
  return MANIFEST
}

const PUBLISHED = MANIFEST.filter(e => !e.withheld)

export function listFamousReplays(): FamousReplay[] {
  return PUBLISHED
}

export function famousBySlug(slug: string): FamousReplay | null {
  return PUBLISHED.find(e => e.slug === slug) ?? null
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
    PUBLISHED.find(
      e => e.address === addr && e.coin === coin && e.range === range && e.interval === interval
    ) ?? null
  )
}
