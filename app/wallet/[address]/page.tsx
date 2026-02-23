'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { WalletProfile } from '@/components/wallet/WalletProfile'
import { SkeletonCard } from '@/components/ui/SkeletonCard'
import { computeDailyPnl, computeSharpe, computeSharpeFromFills, computeWinRate, computeTotalPnl, computeMaxDrawdown } from '@/lib/analytics/pnl'
import { detectArchetype } from '@/lib/analytics/archetype'
import { computeAlphaDecay } from '@/lib/analytics/alphaDecay'
import type { WalletDetail, Fill, ClearinghouseState } from '@/lib/hyperliquid/types'
import { Star } from 'lucide-react'

export default function WalletPage() {
  const params = useParams()
  const address = params.address as string
  const [detail, setDetail] = useState<WalletDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadWallet = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/wallets/${address}`)
      const data = await res.json()
      if (res.ok && data.state) {
        setDetail(data as WalletDetail)
      } else {
        setError(data.error || 'Could not load wallet data')
      }
    } catch {
      setError('Network error - please try again')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (address) loadWallet()
  }, [address]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div>
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
        <div className="px-4 py-12 text-center">
          <p className="text-white/55 mb-2">{error || 'Wallet not found or API error'}</p>
          <p className="text-white/40 text-xs font-mono mb-4">{address}</p>
          <button onClick={loadWallet} className="text-sm bg-[#34EAB9] text-[#0F1A1E] font-semibold px-4 py-2 rounded">
            Retry
          </button>
        </div>
      </div>
    )
  }

  const fills = detail.fills || []
  const state = detail.state || { assetPositions: [], crossMarginSummary: { accountValue: '0', totalMarginUsed: '0', totalNtlPos: '0', totalRawUsd: '0' }, marginSummary: { accountValue: '0', totalMarginUsed: '0', totalNtlPos: '0', totalRawUsd: '0' }, withdrawable: '0' }

  const dailyPnl = computeDailyPnl(fills as Fill[])
  const dailyValues = dailyPnl.map(d => d.pnl)
  const archetypeResult = detectArchetype(fills as Fill[], state as ClearinghouseState)

  // Compute Sharpe from daily data, falling back to fill-level computation
  function sharpeOrFallback(days: number): number {
    const daily = computeSharpe(dailyValues.slice(-days))
    if (!isNaN(daily)) return daily
    return computeSharpeFromFills(fills as Fill[], days)
  }

  const analytics = {
    archetype: archetypeResult.archetype,
    confidence: archetypeResult.confidence,
    sharpe7d: sharpeOrFallback(7),
    sharpe30d: sharpeOrFallback(30),
    sharpe90d: sharpeOrFallback(90),
    winRate: computeWinRate(fills as Fill[]),
    totalPnl: computeTotalPnl(fills as Fill[]),
    alphaDecay: computeAlphaDecay(fills as Fill[]),
    maxDrawdown: computeMaxDrawdown(dailyValues),
    tradeCount: fills.length
  }

  return (
    <div>
      <div className="px-4 py-4 lg:px-6">
        <div className="flex justify-end mb-3">
          <button className="flex items-center gap-1.5 text-xs text-white/55 hover:text-[#34EAB9] transition-colors">
            <Star size={14} />
            Add to Watchlist
          </button>
        </div>
        <WalletProfile detail={detail} analytics={analytics} dailyPnl={dailyPnl} />
      </div>
    </div>
  )
}
