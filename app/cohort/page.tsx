import type { Metadata } from 'next'
import Link from 'next/link'
import { ExternalLink, ArrowRight, Download } from 'lucide-react'
import { getSupabase } from '@/lib/db/supabase'
import { BottomNav } from '@/components/layout/BottomNav'
import { loadCohort, cohortCsv, sha256Hex, type CohortWallet } from '@/lib/cohort'

// The receipts page behind "N wallets tracked". Public, no login,
// server-rendered per request: every count on this page comes from a live
// paginated read of the wallets table (lib/cohort.ts) — nothing is
// hardcoded, and a failed read renders an honest empty state, never a
// cached or invented list.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'The Cohort — AlphaLens',
  description:
    'Every wallet AlphaLens captures, listed: address, archetype, and 30d activity. Verifiable against Hypurrscan, downloadable as a hashed CSV snapshot.',
}

const REPO = 'https://github.com/darylirl/alphalens'

const ARCHETYPE_LABELS: Record<string, string> = {
  market_maker: 'Market Maker',
  momentum_trader: 'Momentum',
  basis_trader: 'Basis Trader',
  whale: 'Whale',
  scalper: 'Scalper',
  swing_trader: 'Swing Trader',
  unclassified: 'Unclassified',
}

const ARCHETYPE_STYLES: Record<string, string> = {
  market_maker: 'bg-violet-500/10 text-violet-400',
  momentum_trader: 'bg-blue-500/10 text-blue-400',
  basis_trader: 'bg-amber-500/10 text-amber-400',
  whale: 'bg-cyan-500/10 text-cyan-400',
  scalper: 'bg-pink-500/10 text-pink-400',
  swing_trader: 'bg-emerald-500/10 text-emerald-400',
  unclassified: 'bg-white/[0.04] text-white/40',
}

// Copyability context per archetype — every number below is from the two
// published backtest runs (backtest_results/ in the repo, written up in the
// copy-trading autopsy). Archetypes we did not replay say so instead of
// borrowing a number.
const ARCHETYPE_CONTEXT: Record<string, { line: string; fromResearch: boolean }> = {
  scalper: {
    line:
      'The one copyable top-Sharpe wallet in our first replay was a scalper: 7,499 copied trades, 4.8% win rate, −$1,252 net in under three days. The 60s delay alone destroyed the edge.',
    fromResearch: true,
  },
  swing_trader: {
    line:
      'Swing wallets held over 4 hours in our tests (3.9 days on average) and still showed no copyable aggregate edge: 27,865 replayed trades, net −$9,362.',
    fromResearch: true,
  },
  momentum_trader: {
    line:
      'Momentum wallets fared no better in the same replay: 453 trades, net −$342, profit factor 0.69.',
    fromResearch: true,
  },
  basis_trader: {
    line:
      'Not covered by our replay tests — captured for aggregate flow context, with no copyability claim either way.',
    fromResearch: false,
  },
  whale: {
    line:
      'Not covered by our replay tests — captured for aggregate flow context, with no copyability claim either way.',
    fromResearch: false,
  },
  unclassified: {
    line:
      'In capture scope because an active signal or a verification job references the wallet, not because of behavioral classification.',
    fromResearch: false,
  },
}

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

async function loadPage(): Promise<{ wallets: CohortWallet[]; csvSha256: string } | null> {
  try {
    const wallets = await loadCohort(getSupabase())
    return { wallets, csvSha256: sha256Hex(cohortCsv(wallets)) }
  } catch {
    return null
  }
}

export default async function CohortPage() {
  const snapshot = await loadPage()

  if (!snapshot) {
    return (
      <div className="pb-20 md:pb-8">
        <div className="px-4 py-4 lg:px-6 max-w-2xl mx-auto">
          <h1 className="text-lg font-bold mb-2">The cohort</h1>
          <div className="card p-8 text-center">
            <p className="text-sm font-semibold mb-1">Cohort list unavailable</p>
            <p className="text-white/40 text-xs">
              This page renders only from a live database read. The read
              failed just now — nothing is shown rather than a stale or
              invented list.
            </p>
          </div>
        </div>
        <div className="md:hidden"><BottomNav /></div>
      </div>
    )
  }

  const { wallets, csvSha256 } = snapshot
  const byArchetype = new Map<string, number>()
  for (const w of wallets) {
    const key = w.archetype ?? 'unclassified'
    byArchetype.set(key, (byArchetype.get(key) ?? 0) + 1)
  }
  const archetypes = [...byArchetype.entries()].sort((a, b) => b[1] - a[1])

  return (
    <div className="pb-20 md:pb-8">
      <div className="px-4 py-4 lg:px-6 max-w-2xl mx-auto space-y-4">
        <div>
          <h1 className="text-lg font-bold mb-1">The cohort</h1>
          <p className="text-white/55 text-xs leading-relaxed">
            Every wallet our capture daemon records, listed in full. This is
            the receipts page behind &ldquo;wallets tracked&rdquo; — check any
            address against sources we do not control.
          </p>
        </div>

        {/* Live count — from the paginated read that also renders the list below */}
        <div className="card p-4">
          <p className="font-mono text-3xl font-bold text-[#F0FAF8]">
            {wallets.length.toLocaleString()}
          </p>
          <p className="text-[11px] text-white/40 mt-0.5">
            wallets in capture scope right now (live count, queried on every
            page load)
          </p>
        </div>

        {/* Selection criteria, in plain language */}
        <div className="card p-4">
          <p className="text-xs font-semibold mb-2">How wallets get on this list</p>
          <ul className="text-[11px] text-white/55 leading-relaxed space-y-1.5 list-disc pl-4">
            <li>
              Classified by observed behavior — hold times, two-sided share,
              trade rate, position sizes — from public Hyperliquid fill and
              position data. No self-reporting, no submissions.
            </li>
            <li>
              Market-maker wallets are excluded from capture as of
              Aug 25, 2026: their two-sided inventory churn is
              market-neutral noise, not directional signal, and it dominated
              both disk growth and the /pulse skews.
            </li>
            <li>
              A handful of wallets are in scope because an active signal or a
              verification job references them, independent of classification.
            </li>
          </ul>
          <a
            href={`${REPO}/blob/HEAD/lib/wallets/classify.ts`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-3 text-[11px] text-[#34EAB9] font-medium hover:underline"
          >
            Read the selection code <ExternalLink size={10} />
          </a>
          <a
            href={`${REPO}/blob/HEAD/supabase/migrations/016_capture_scope_exclude_market_makers.sql`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-3 ml-4 text-[11px] text-[#34EAB9] font-medium hover:underline"
          >
            The market-maker exclusion <ExternalLink size={10} />
          </a>
        </div>

        {/* Archetypes present, each with its honest copyability context */}
        <div className="card p-4">
          <p className="text-xs font-semibold mb-3">What the archetypes mean for you: nothing</p>
          <div className="space-y-3">
            {archetypes.map(([key, count]) => {
              const ctx = ARCHETYPE_CONTEXT[key]
              return (
                <div key={key}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${ARCHETYPE_STYLES[key] ?? ARCHETYPE_STYLES.unclassified}`}>
                      {ARCHETYPE_LABELS[key] ?? key}
                    </span>
                    <span className="text-[10px] text-white/40 font-mono">{count}</span>
                  </div>
                  {ctx && (
                    <p className="text-[11px] text-white/55 leading-relaxed">
                      {ctx.line}
                      {ctx.fromResearch && (
                        <>
                          {' '}
                          <Link href="/research/copy-trading-autopsy" className="text-[#34EAB9] hover:underline">
                            The autopsy
                          </Link>
                        </>
                      )}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
          <p className="text-[11px] text-white/40 leading-relaxed mt-3 pt-3 border-t border-white/[0.08]">
            This list exists so you can verify what we capture — it is not a
            list of wallets to follow. We replayed 28,318 trades from wallets
            like these with honest frictions and lost money. Nothing here is
            a recommendation.
          </p>
        </div>

        {/* CSV snapshot + hash */}
        <div className="card p-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-xs font-semibold">Snapshot for auditors</p>
            <a
              href="/api/cohort/csv"
              className="inline-flex items-center gap-1.5 bg-[#34EAB9] text-[#0F1A1E] font-semibold text-[11px] px-3 py-1.5 rounded hover:brightness-110 transition-all"
            >
              <Download size={11} /> Download CSV
            </a>
          </div>
          <p className="text-[11px] text-white/55 leading-relaxed mb-2">
            The CSV (address, archetype, added_at) is generated from the live
            table at request time. SHA-256 of the snapshot rendered with this
            page:
          </p>
          <p className="font-mono text-[10px] text-white/70 break-all bg-[#0F1A1E] rounded p-2">
            {csvSha256}
          </p>
          <p className="text-[10px] text-white/30 mt-2 leading-relaxed">
            Hash the file you download (<span className="font-mono">shasum -a 256</span>)
            and it matches this value unless the cohort changed between the
            page render and your download — record the hash on any given day
            to prove what the list was.
          </p>
        </div>

        {/* The full list */}
        <div>
          <p className="text-xs font-semibold mb-2">
            All {wallets.length.toLocaleString()} wallets
          </p>
          <div className="card divide-y divide-white/[0.06]">
            {wallets.map(w => {
              const key = w.archetype ?? 'unclassified'
              return (
                <div key={w.address} className="flex items-center gap-2 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/wallet/${w.address}`}
                      className="font-mono text-[11px] text-[#F0FAF8] hover:text-[#34EAB9] transition-colors"
                      title={w.address}
                    >
                      {shortAddr(w.address)}
                    </Link>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-[9px] px-1 py-px rounded font-medium ${ARCHETYPE_STYLES[key] ?? ARCHETYPE_STYLES.unclassified}`}>
                        {ARCHETYPE_LABELS[key] ?? key}
                      </span>
                      {w.trade_count_30d != null && (
                        <span className="text-[9px] text-white/40 font-mono">
                          {w.trade_count_30d.toLocaleString()} trades/30d
                        </span>
                      )}
                    </div>
                  </div>
                  <Link
                    href={`/card/${w.address}`}
                    className="text-[10px] text-white/40 hover:text-[#34EAB9] transition-colors shrink-0"
                  >
                    card
                  </Link>
                  <Link
                    href={`/replay/${w.address}`}
                    className="text-[10px] text-white/40 hover:text-[#34EAB9] transition-colors shrink-0"
                  >
                    replay
                  </Link>
                  <Link
                    href={`/wallet/${w.address}`}
                    className="text-[10px] text-white/40 hover:text-[#34EAB9] transition-colors shrink-0"
                  >
                    history
                  </Link>
                  <a
                    href={`https://hypurrscan.io/address/${w.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 text-[10px] text-white/40 hover:text-[#34EAB9] transition-colors shrink-0"
                  >
                    hypurrscan <ExternalLink size={9} />
                  </a>
                </div>
              )
            })}
          </div>
          <p className="text-[10px] text-white/30 mt-2 leading-relaxed">
            30d trade counts are rate-normalized from each wallet&rsquo;s most
            recent classification sample (the exchange serves ~2,000 recent
            fills per wallet), not live counters. Addresses link to
            hypurrscan.io — an explorer we do not control — so existence and
            history are verifiable outside our database.
          </p>
        </div>

        <div className="flex justify-center pb-2">
          <Link
            href="/pulse"
            className="inline-flex items-center gap-1 text-[11px] text-[#34EAB9] font-medium hover:underline"
          >
            See what this cohort is doing on /pulse <ArrowRight size={10} />
          </Link>
        </div>
      </div>

      <div className="md:hidden">
        <BottomNav />
      </div>
    </div>
  )
}
