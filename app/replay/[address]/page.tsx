import type { Metadata } from 'next'
import Link from 'next/link'
import { validateAddress } from '@/lib/validation'
import { BottomNav } from '@/components/layout/BottomNav'
import { ReplayPlayer } from '@/components/replay/ReplayPlayer'
import { AddressPaste } from '@/components/card/AddressPaste'

// Trade playback for any wallet. The differentiation is stated on the page
// because it is real: the replay marks actual fills at exchange-exact
// execution prices — not mark-priced approximations — and every frame of an
// exported clip carries its coverage strip.

export const dynamic = 'force-dynamic'

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

export function generateMetadata({ params }: { params: { address: string } }): Metadata {
  const address = validateAddress(params.address)
  const title = address
    ? `Replay ${shortAddr(address)} — AlphaLens`
    : 'Trade replay — AlphaLens'
  return {
    title,
    description:
      'Watch a wallet trade, episode by episode: round trips replayed as forming candles with every real fill announced, at exchange-exact execution prices, with honest data coverage and an exportable clip.',
    twitter: { card: 'summary_large_image' },
  }
}

export default function ReplayPage({
  params,
  searchParams,
}: {
  params: { address: string }
  searchParams?: { coin?: string }
}) {
  const address = validateAddress(params.address)
  // ?coin= deep link: a shared replay skips the menu and builds that coin
  // straight away. Same charset rule the doc API enforces.
  const coinParam = searchParams?.coin
  const initialCoin =
    typeof coinParam === 'string' && /^[A-Za-z0-9@:_.-]{1,32}$/.test(coinParam) ? coinParam : null

  return (
    <div className="pb-20 md:pb-8">
      <div className="px-4 py-4 lg:px-6 space-y-4">
        <div className="max-w-2xl mx-auto space-y-4">
          <div>
            <h1 className="text-lg font-bold mb-1">Trade replay</h1>
            <p className="text-white/55 text-xs leading-relaxed">
              The wallet&rsquo;s actual trades, played back episode by episode — each round trip of
              the position leaving zero and returning to it — at{' '}
              <span className="text-[#F0FAF8]">exchange-exact execution prices</span>. Every
              marker is a real fill at its reported price, and the running PnL is the
              exchange&rsquo;s own realized figures. Not a mark-priced reconstruction.
            </p>
          </div>
          <AddressPaste basePath="/replay" />
        </div>

        {address ? (
          <ReplayPlayer address={address} initialCoin={initialCoin} />
        ) : (
          <div className="card p-6 text-center max-w-2xl mx-auto">
            <p className="text-sm font-semibold mb-1">Not a wallet address</p>
            <p className="text-xs text-white/40">
              Expected 0x followed by 40 hex characters. Paste one above.
            </p>
          </div>
        )}

        {address && (
          <div className="max-w-2xl mx-auto space-y-3">
            <p className="text-[10px] text-white/30 text-center">
              <Link href={`/card/${address}`} className="text-[#34EAB9] hover:underline">
                See the grade
              </Link>{' '}
              · the report card behind this wallet
            </p>
            <p className="text-[10px] text-white/30 text-center pb-2">
              Cohort wallets replay from our capture store; pasted wallets replay the
              exchange&rsquo;s recent window and are labelled as such. Candles come from the
              retention ladder, never interpolated. Nothing here is a recommendation.
            </p>
          </div>
        )}
      </div>

      <div className="md:hidden">
        <BottomNav />
      </div>
    </div>
  )
}
