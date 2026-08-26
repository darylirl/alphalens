import Link from 'next/link'
import type { CohortWallet } from '@/lib/cohort'

// Tappable example chips for the /card and /replay index pages, so a visitor
// without an address of their own can experience the surface. The list is a
// live archetype-varied read of the capture cohort (lib/cohort.ts); when that
// read fails the empty state says so — no cached or hardcoded fallback list.

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

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

export function ExampleWallets({
  basePath,
  wallets,
}: {
  basePath: '/card' | '/replay'
  wallets: CohortWallet[]
}) {
  if (wallets.length === 0) {
    return (
      <p className="text-[11px] text-white/40 leading-relaxed">
        Example wallets are unavailable right now — the live cohort read
        failed, and nothing is shown rather than a stale list. Paste an
        address above.
      </p>
    )
  }

  return (
    <div>
      <p className="text-[11px] text-white/40 mb-2">
        No address handy? Try a wallet from the tracked cohort:
      </p>
      <div className="flex flex-wrap gap-2">
        {wallets.map(w => {
          const key = w.archetype ?? 'unclassified'
          return (
            <Link
              key={w.address}
              href={`${basePath}/${w.address}`}
              className="flex items-center gap-2 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2.5 hover:border-[#34EAB9]/40 transition-colors"
              title={w.address}
            >
              <span className="font-mono text-[11px] text-[#F0FAF8]">
                {shortAddr(w.address)}
              </span>
              <span
                className={`text-[9px] px-1 py-px rounded font-medium ${ARCHETYPE_STYLES[key] ?? ARCHETYPE_STYLES.unclassified}`}
              >
                {ARCHETYPE_LABELS[key] ?? key}
              </span>
            </Link>
          )
        })}
      </div>
      <p className="text-[10px] text-white/30 mt-2 leading-relaxed">
        Pulled live from the{' '}
        <Link href="/cohort" className="text-[#34EAB9] hover:underline">
          capture cohort
        </Link>{' '}
        on every page load — examples of what we track, not wallets to follow.
      </p>
    </div>
  )
}
