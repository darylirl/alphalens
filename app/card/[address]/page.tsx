import type { Metadata } from 'next'
import Link from 'next/link'
import { validateAddress } from '@/lib/validation'
import { BottomNav } from '@/components/layout/BottomNav'
import { ReportCardView } from '@/components/card/ReportCardView'
import { AddressPaste } from '@/components/card/AddressPaste'

// The Wallet Report Card. Paste-only — no wallet connect. The shell renders
// immediately; the graded numbers stream in from /api/card/[address], which
// is the same builder the OG share image draws from.

export const dynamic = 'force-dynamic'

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

export function generateMetadata({ params }: { params: { address: string } }): Metadata {
  const address = validateAddress(params.address)
  const title = address
    ? `Report card ${shortAddr(address)} — AlphaLens`
    : 'Wallet report card — AlphaLens'
  return {
    title,
    description:
      'True all-time PnL from the exchange, statistically-floored grades, adjusted win rate, and honest data coverage for any Hyperliquid wallet.',
    twitter: { card: 'summary_large_image' },
  }
}

export default function CardPage({ params }: { params: { address: string } }) {
  const address = validateAddress(params.address)

  return (
    <div className="pb-20 md:pb-8">
      <div className="px-4 py-4 lg:px-6 max-w-2xl mx-auto space-y-4">
        <div>
          <h1 className="text-lg font-bold mb-1">Wallet report card</h1>
          <p className="text-white/55 text-xs leading-relaxed">
            Measured history, graded with statistical floors. All-time PnL is the exchange&rsquo;s
            own figure; everything else is computed from real fills and says exactly which window
            it covers.
          </p>
        </div>

        <AddressPaste basePath="/card" />

        {address ? (
          <ReportCardView address={address} />
        ) : (
          <div className="card p-6 text-center">
            <p className="text-sm font-semibold mb-1">Not a wallet address</p>
            <p className="text-xs text-white/40">
              Expected 0x followed by 40 hex characters. Paste one above.
            </p>
          </div>
        )}

        {address && (
          <p className="text-[10px] text-white/30 text-center pb-2">
            <Link href={`/replay/${address}`} className="text-[#34EAB9] hover:underline">
              See the film
            </Link>{' '}
            · replay this wallet&rsquo;s trades at exchange-exact prices
          </p>
        )}
      </div>

      <div className="md:hidden">
        <BottomNav />
      </div>
    </div>
  )
}
