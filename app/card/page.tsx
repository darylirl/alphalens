import type { Metadata } from 'next'
import Link from 'next/link'
import { getSupabase } from '@/lib/db/supabase'
import { loadExampleWallets, type CohortWallet } from '@/lib/cohort'
import { BottomNav } from '@/components/layout/BottomNav'
import { AddressPaste } from '@/components/card/AddressPaste'
import { ExampleWallets } from '@/components/card/ExampleWallets'

// Index page for the Wallet Report Card: the entry point reached from the
// nav. Paste any address, or tap a live example from the capture cohort.
// Server-rendered per request so the examples are the cohort as it is now.

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Wallet report card — AlphaLens',
  description:
    'Paste any Hyperliquid wallet address for a graded report card: the exchange’s own all-time PnL, statistically-floored grades, adjusted win rate, and honest data coverage.',
}

async function loadExamples(): Promise<CohortWallet[]> {
  try {
    return await loadExampleWallets(getSupabase())
  } catch {
    return [] // ExampleWallets renders the honest empty state
  }
}

export default async function CardIndexPage() {
  const examples = await loadExamples()

  return (
    <div className="pb-20 md:pb-8">
      <div className="px-4 py-4 lg:px-6 max-w-2xl mx-auto space-y-4">
        <div>
          <h1 className="text-lg font-bold mb-1">Wallet report card</h1>
          <p className="text-white/55 text-xs leading-relaxed">
            Paste any Hyperliquid wallet and get its measured history, graded
            with statistical floors — the exchange&rsquo;s own all-time PnL,
            and a coverage block that says exactly which window was measured.
          </p>
        </div>

        <AddressPaste basePath="/card" />

        <ExampleWallets basePath="/card" wallets={examples} />

        <p className="text-[10px] text-white/30 text-center pb-2">
          Prefer the film?{' '}
          <Link href="/replay" className="text-[#34EAB9] hover:underline">
            Trade replay
          </Link>{' '}
          · watch a wallet&rsquo;s trades play back at exchange-exact prices
        </p>
      </div>

      <div className="md:hidden">
        <BottomNav />
      </div>
    </div>
  )
}
