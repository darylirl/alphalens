'use client'
import { useEffect, useState } from 'react'
import { TopBar } from '@/components/layout/TopBar'
import { FilterPanel } from '@/components/hunting/FilterPanel'
import { HunterLeaderboard } from '@/components/hunting/HunterLeaderboard'
import type { WalletAnalytics } from '@/lib/hyperliquid/types'

export default function HuntersPage() {
  const [wallets, setWallets] = useState<WalletAnalytics[]>([])
  const [loading, setLoading] = useState(true)
  const [archetype, setArchetype] = useState('all')
  const [sort, setSort] = useState('sharpe_30d')

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const params = new URLSearchParams({ archetype, sort, limit: '50' })
        const res = await fetch(`/api/hunters?${params}`)
        if (res.ok) {
          const data = await res.json()
          setWallets(Array.isArray(data) ? data.map((w: Record<string, unknown>) => ({
            address: w.address as string,
            label: w.label as string | undefined,
            archetype: w.archetype as string || 'unknown',
            archetypeConfidence: w.archetype_confidence as number || 0,
            sharpe7d: 0,
            sharpe30d: w.sharpe_30d as number || 0,
            sharpe90d: w.sharpe_90d as number || 0,
            alphaDecayScore: w.alpha_decay_score as number || 0,
            winRate: w.win_rate as number || 0,
            totalPnlUsd: w.total_pnl_usd as number || 0,
            tradeCount30d: w.trade_count_30d as number || 0,
            avgHoldSeconds: 0,
            avgLeverage: w.avg_leverage as number || 0,
            mostTradedAsset: '',
          })) : [])
        }
      } catch {
        // API not configured yet
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [archetype, sort])

  return (
    <div>
      <TopBar title="Alpha Hunters" />
      <div className="px-4 py-4 lg:px-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold mb-1">Alpha Hunting Engine</h2>
          <p className="text-[#888888] text-xs">Discover top-performing wallets ranked by behavior, not just PnL</p>
        </div>

        <FilterPanel
          archetype={archetype}
          sort={sort}
          onArchetypeChange={setArchetype}
          onSortChange={setSort}
        />

        <HunterLeaderboard wallets={wallets} loading={loading} />
      </div>
    </div>
  )
}
