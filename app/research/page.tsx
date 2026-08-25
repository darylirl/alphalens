import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

// Research index. Static: entries are code in this repo, no CMS, no
// database reads. Every entry links a post whose numbers trace to
// published data (backtest_results/, the verification ledger).

export const metadata: Metadata = {
  title: 'Research — AlphaLens',
  description:
    'Published verdicts from the AlphaLens verification engine — wins and kills alike. A track record you curate is not a track record.',
  openGraph: {
    title: 'AlphaLens Research',
    description:
      'Published verdicts from the verification engine — wins and kills alike.',
    type: 'website',
    siteName: 'AlphaLens Research',
  },
}

const entries = [
  {
    slug: 'copy-trading-autopsy',
    verdict: 'Killed',
    date: 'August 25, 2026',
    title: 'Killed: copy-trading smart wallets',
    summary:
      '28,318 replayed trades across two cohorts and 13 months. Net −$9,704 with gross negative before a single fee. Why following the leaderboard structurally cannot work.',
  },
]

export default function ResearchIndexPage() {
  return (
    <div className="px-4 py-8 lg:px-6 max-w-2xl mx-auto">
      <h1 className="text-2xl md:text-3xl font-bold text-[#F0FAF8] mb-2">Research</h1>
      <p className="text-sm text-white/55 leading-relaxed mb-8">
        Everything we test publishes here — passes and kills alike, with the
        data to check us. A track record you curate is not a track record.
      </p>

      <div className="space-y-3">
        {entries.map((e) => (
          <Link
            key={e.slug}
            href={`/research/${e.slug}`}
            className="block bg-[#0F1A1E] border border-white/[0.08] rounded-lg p-5 hover:border-[#34EAB9]/40 transition-colors group"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-[#FF3B5C] border border-[#FF3B5C]/40 rounded px-1.5 py-0.5">
                {e.verdict}
              </span>
              <span className="text-[10px] text-white/40">{e.date}</span>
            </div>
            <p className="text-base font-semibold text-[#F0FAF8] mb-1.5">{e.title}</p>
            <p className="text-xs text-white/55 leading-relaxed mb-2">{e.summary}</p>
            <span className="inline-flex items-center gap-1 text-[11px] text-[#34EAB9] font-medium group-hover:underline">
              Read the autopsy <ArrowRight size={10} />
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
