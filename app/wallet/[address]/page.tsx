'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { TopBar } from '@/components/layout/TopBar'
import { WalletProfile } from '@/components/wallet/WalletProfile'
import { SkeletonCard } from '@/components/ui/SkeletonCard'
import { computeDailyPnl, computeSharpe, computeWinRate, computeTotalPnl, computeMaxDrawdown } from '@/lib/analytics/pnl'
import { detectArchetype } from '@/lib/analytics/archetype'
import { computeAlphaDecay } from '@/lib/analytics/alphaDecay'
import type { WalletDetail, Fill, ClearinghouseState } from '@/lib/hyperliquid/types'
import { Star } from 'lucide-react'

export default function WalletPage() {
  const params = useParams()
  const address = params.address as string
  const [detail, setDetail] = useState<WalletDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const res = await fetch(`/api/wallets/${address}`)
        if (res.ok) {
          const data = await res.json()
          setDetail(data as WalletDetail)
        }
      } catch {
        // Will retry
      } finally {
        setLoading(false)
      }
    }
    if (address) load()
  }, [address])

  if (loading) {
    return (
      <div>
        <TopBar title="Wallet" />
        <div className="px-4 py-4 lg:px-6 space-y-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div>
        <TopBar title="Wallet" />
        <div className="px-4 py-12 text-center">
          <p className="text-[#888888]">Wallet not found or API error</p>
        </div>
      </div>
    )
  }

  const fills = detail.fills || []
  const state = detail.state || { assetPositions: [], crossMarginSummary: { accountValue: '0', totalMarginUsed: '0', totalNtlPos: '0', totalRawUsd: '0' }, marginSummary: { accountValue: '0', totalMarginUsed: '0', totalNtlPos: '0', totalRawUsd: '0' }, withdrawable: '0' }

  const dailyPnl = computeDailyPnl(fills as Fill[])
  const dailyValues = dailyPnl.map(d => d.pnl)
  const archetypeResult = detectArchetype(fills as Fill[], state as ClearinghouseState)

  const analytics = {
    archetype: archetypeResult.archetype,
    confidence: archetypeResult.confidence,
    sharpe7d: computeSharpe(dailyValues.slice(-7)),
    sharpe30d: computeSharpe(dailyValues.slice(-30)),
    sharpe90d: computeSharpe(dailyValues.slice(-90)),
    winRate: computeWinRate(fills as Fill[]),
    totalPnl: computeTotalPnl(fills as Fill[]),
    alphaDecay: computeAlphaDecay(fills as Fill[]),
    maxDrawdown: computeMaxDrawdown(dailyValues),
    tradeCount: fills.length
  }

  return (
    <div>
      <TopBar title="Wallet Profile" />
      <div className="px-4 py-4 lg:px-6">
        <div className="flex justify-end mb-3">
          <button className="flex items-center gap-1.5 text-xs text-[#888888] hover:text-[#00ff88] transition-colors">
            <Star size={14} />
            Add to Watchlist
          </button>
        </div>
        <WalletProfile detail={detail} analytics={analytics} dailyPnl={dailyPnl} />
      </div>
    </div>
  )
}
