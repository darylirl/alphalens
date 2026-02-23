'use client'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { FilterPanel, type AdvancedFilters } from '@/components/hunting/FilterPanel'
import { HunterLeaderboard } from '@/components/hunting/HunterLeaderboard'
import type { WalletAnalytics } from '@/lib/hyperliquid/types'

const DEFAULT_FILTERS: AdvancedFilters = { minTrades: '', minWinRate: '', minPnl: '', maxLeverage: '', timeWindow: '30' }

// Map query param values to archetype filter values
const ARCHETYPE_MAP: Record<string, string> = {
  'scalper': 'scalper',
  'swing trader': 'swing_trader',
  'momentum trader': 'momentum_trader',
  'momentum': 'momentum_trader',
  'high conviction': 'high_conviction',
  'funding arb': 'funding_arb',
  'farmer (delta-neutral)': 'farmer',
  'farmer': 'farmer',
  'market maker': 'market_maker',
}

export default function HuntersPage() {
  return (
    <Suspense fallback={<div className="px-4 py-8 text-center text-white/55 text-sm">Loading...</div>}>
      <HuntersContent />
    </Suspense>
  )
}

function HuntersContent() {
  const searchParams = useSearchParams()
  const typeParam = searchParams.get('type') || ''
  const initialArchetype = typeParam ? (ARCHETYPE_MAP[typeParam.toLowerCase()] || 'all') : 'all'

  const [wallets, setWallets] = useState<WalletAnalytics[]>([])
  const [loading, setLoading] = useState(true)
  const [seeding, setSeeding] = useState(false)
  const [archetype, setArchetype] = useState(initialArchetype)
  const [sort, setSort] = useState('sharpe_30d')
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilters>(DEFAULT_FILTERS)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const params = new URLSearchParams({ archetype, sort, limit: '50' })
        if (advancedFilters.minTrades) params.set('minTrades', advancedFilters.minTrades)
        if (advancedFilters.minWinRate) params.set('minWinRate', advancedFilters.minWinRate)
        if (advancedFilters.minPnl) params.set('minPnl', advancedFilters.minPnl)
        if (advancedFilters.maxLeverage) params.set('maxLeverage', advancedFilters.maxLeverage)
        const res = await fetch(`/api/hunters?${params}`)
        if (res.ok) {
          const data = await res.json()
          if (data.seeding) {
            setSeeding(true)
            setWallets([])
            setTimeout(() => { setSeeding(false); load() }, 30000)
            return
          }
          setSeeding(false)
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
  }, [archetype, sort, advancedFilters])

  return (
    <div>
      <div className="px-4 py-4 lg:px-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold mb-1">Alpha Hunting Engine</h2>
          <p className="text-white/55 text-xs">Discover high-performing wallets with advanced filtering including drawdown analysis, trade size metrics, and current account balances</p>
        </div>

        <FilterPanel
          archetype={archetype}
          sort={sort}
          onArchetypeChange={setArchetype}
          onSortChange={setSort}
          advancedFilters={advancedFilters}
          onAdvancedFiltersChange={setAdvancedFilters}
        />

        {seeding ? (
          <div className="text-center py-12">
            <div className="inline-block w-8 h-8 border-2 border-[#34EAB9] border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-white/55 text-sm">Discovering wallets from Hyperliquid...</p>
            <p className="text-white/40 text-xs mt-1">This takes ~30 seconds on first load</p>
          </div>
        ) : (
          <HunterLeaderboard wallets={wallets} loading={loading} />
        )}
      </div>
    </div>
  )
}
