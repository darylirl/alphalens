import type { Metadata } from 'next'
import Link from 'next/link'
import { getSupabase } from '@/lib/db/supabase'
import { loadExampleWallets, type CohortWallet } from '@/lib/cohort'
import { BottomNav } from '@/components/layout/BottomNav'
import { AddressPaste } from '@/components/card/AddressPaste'
import { ExampleWallets } from '@/components/card/ExampleWallets'
import { FamousStrip } from '@/components/replay/FamousStrip'
import { listFamousReplays } from '@/lib/replay/famous'

// Index page for Trade Replay: the entry point reached from the nav. Paste
// any address, or tap a live example from the capture cohort.
// Server-rendered per request so the examples are the cohort as it is now.

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Trade replay — AlphaLens',
  description:
    'Paste any Hyperliquid wallet address and watch its actual trades play back on real candles at exchange-exact execution prices, with honest data coverage.',
}

async function loadExamples(): Promise<CohortWallet[]> {
  try {
    return await loadExampleWallets(getSupabase())
  } catch {
    return [] // ExampleWallets renders the honest empty state
  }
}

export default async function ReplayIndexPage() {
  const examples = await loadExamples()

  return (
    <div className="pb-20 md:pb-8">
      <div className="px-4 py-4 lg:px-6 max-w-2xl mx-auto space-y-4">
        <div>
          <h1 className="text-lg font-bold mb-1">Trade replay</h1>
          <p className="text-white/55 text-xs leading-relaxed">
            Paste any Hyperliquid wallet and watch its actual trades play back
            on the chart — every marker a real fill at{' '}
            <span className="text-[#F0FAF8]">exchange-exact execution prices</span>,
            never a mark-priced reconstruction.
          </p>
        </div>

        <FamousStrip entries={listFamousReplays()} />

        <AddressPaste basePath="/replay" />

        <ExampleWallets basePath="/replay" wallets={examples} />

        <p className="text-[10px] text-white/30 text-center pb-2">
          Prefer the grade?{' '}
          <Link href="/card" className="text-[#34EAB9] hover:underline">
            Wallet report card
          </Link>{' '}
          · measured history with statistical floors
        </p>
      </div>

      <div className="md:hidden">
        <BottomNav />
      </div>
    </div>
  )
}
