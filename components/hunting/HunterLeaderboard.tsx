'use client'
import { WalletCard } from '@/components/wallet/WalletCard'
import { SkeletonCard } from '@/components/ui/SkeletonCard'
import type { WalletAnalytics } from '@/lib/hyperliquid/types'

interface HunterLeaderboardProps {
  wallets: WalletAnalytics[]
  loading: boolean
}

export function HunterLeaderboard({ wallets, loading }: HunterLeaderboardProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    )
  }

  if (!wallets.length) {
    return (
      <div className="text-center py-12">
        <p className="text-[#888888] text-sm">No wallets match your filters</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {wallets.map((w, i) => (
        <WalletCard
          key={w.address}
          address={w.address}
          label={w.label}
          archetype={w.archetype}
          sharpe30d={w.sharpe30d}
          winRate={w.winRate}
          totalPnl={w.totalPnlUsd}
          alphaDecay={w.alphaDecayScore}
          rank={i + 1}
        />
      ))}
    </div>
  )
}
