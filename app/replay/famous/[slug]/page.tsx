import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { famousBySlug } from '@/lib/replay/famous'
import { BottomNav } from '@/components/layout/BottomNav'
import { ReplayPlayer } from '@/components/replay/ReplayPlayer'

// One curated famous replay: the editorial framing around the same player
// every wallet gets. The entry comes from the repo-committed manifest
// (content/famous-replays.json) — every number on this page was verified
// against real fills before it shipped, and the coverage note says exactly
// which data window we can serve. The replay itself ends on our end card:
// the realized result, the honest grade with its sample size, and the
// coverage strip. The spectacle, with receipts.

export const dynamic = 'force-dynamic'

const usd = (n: number) =>
  `${n < 0 ? '−' : '+'}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const entry = famousBySlug(params.slug)
  if (!entry) return { title: 'Famous replay — AlphaLens' }
  return {
    title: `${entry.title} — Famous replays — AlphaLens`,
    description: `${entry.story} Replayed from real fills at exchange-exact execution prices, ${usd(entry.pnl_usd)} realized over the replayed episode, with honest data coverage.`,
    twitter: { card: 'summary_large_image' },
  }
}

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

export default function FamousReplayPage({ params }: { params: { slug: string } }) {
  const entry = famousBySlug(params.slug)
  if (!entry) notFound()

  const windowLabel = `${entry.window.from.slice(0, 10)} – ${entry.window.to.slice(0, 10)}`

  return (
    <div className="pb-20 md:pb-8">
      <div className="px-4 py-4 lg:px-6 space-y-4">
        <div className="max-w-2xl mx-auto space-y-3">
          <Link
            href="/replay"
            className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-[#34EAB9] transition-colors"
          >
            <ArrowLeft size={12} /> Famous replays
          </Link>

          <div>
            <p className="text-[10px] font-mono text-[#F5A623] uppercase tracking-[0.2em] mb-1">
              Famous replay ·{' '}
              {entry.source === 'autopsy'
                ? 'wallet from our copy-trading autopsy'
                : 'public episode'}
            </p>
            <h1 className="text-xl md:text-2xl font-bold leading-tight mb-2">{entry.title}</h1>
            <p className="text-white/60 text-sm leading-relaxed">{entry.story}</p>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono text-white/50">
            <span title={entry.address}>{shortAddr(entry.address)}</span>
            <span className="text-[#F5A623]">{entry.coin}</span>
            <span>{windowLabel}</span>
            <span>{entry.bar_width}</span>
            <span className={entry.pnl_usd >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}>
              {usd(entry.pnl_usd)} realized
            </span>
          </div>
          <p className="text-[10px] text-white/35 leading-relaxed">
            {entry.pnl_basis} · verified against real fills {entry.verified.at.slice(0, 10)} ·{' '}
            {entry.coverage_note}
          </p>
          {/* Which bar widths can still reach this window. A replay that can
              only ever be shown at 4h from here on is a fact about the record,
              not a detail to leave off the page. */}
          <p className="text-[10px] text-white/30 leading-relaxed">
            Bars: {entry.interval_constraint} Replayed from{' '}
            {entry.fills_source === 'store'
              ? 'our capture store'
              : "the exchange's own fill history"}
            , pinned — a rebuild that cannot reach that source refuses rather than serving the
            other one.
          </p>

          {entry.pending_verification && (
            <div className="border border-[#F5A623]/25 bg-[#F5A623]/[0.04] rounded-lg p-3">
              <p className="text-[10px] font-mono text-[#F5A623] uppercase tracking-wider mb-1">
                Not verified
              </p>
              <p className="text-[10px] text-white/50 leading-relaxed">
                {entry.pending_verification}
              </p>
            </div>
          )}
        </div>

        <ReplayPlayer
          address={entry.address}
          initial={{ coin: entry.coin, range: entry.range, interval: entry.interval }}
          famous={{ title: entry.title }}
        />

        <div className="max-w-2xl mx-auto space-y-3">
          {entry.research_context && entry.research_href && (
            <p className="text-[11px] text-white/45 leading-relaxed">
              {entry.research_context}{' '}
              <Link href={entry.research_href} className="text-[#34EAB9] hover:underline">
                Read the autopsy
              </Link>
              .
            </p>
          )}
          {entry.source === 'public' && entry.sources.length > 0 && (
            <p className="text-[10px] text-white/35 text-center leading-relaxed">
              As reported by{' '}
              {entry.sources.map((s, i) => {
                let host = s
                try {
                  host = new URL(s).hostname.replace(/^www\./, '')
                } catch {}
                return (
                  <span key={s}>
                    {i > 0 && ' · '}
                    <a
                      href={s}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white/50 hover:text-[#34EAB9] underline decoration-white/20"
                    >
                      {host}
                    </a>
                  </span>
                )
              })}
              {' '}— the story; the numbers above come from the fills.
            </p>
          )}
          <p className="text-[10px] text-white/30 text-center">
            <Link href={`/card/${entry.address}`} className="text-[#34EAB9] hover:underline">
              See the grade
            </Link>{' '}
            · the report card behind this wallet ·{' '}
            <Link href={`/replay/${entry.address}`} className="text-[#34EAB9] hover:underline">
              explore its full replay
            </Link>
          </p>
          <p className="text-[10px] text-white/30 text-center pb-2">
            Every marker is a real fill at its exchange-reported price; the realized PnL is the
            exchange&rsquo;s own figures. The coverage strip states exactly which window we can
            serve. Nothing here is a recommendation.
          </p>
        </div>
      </div>

      <div className="md:hidden">
        <BottomNav />
      </div>
    </div>
  )
}
