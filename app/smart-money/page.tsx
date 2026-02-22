'use client'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { TopBar } from '@/components/layout/TopBar'
import { SkeletonCard } from '@/components/ui/SkeletonCard'

interface TierData {
  name: string
  emoji: string
  count: number
  sentiment: 'Bullish' | 'Bearish' | 'Neutral'
  inPosition: number
  longRatio: number
  netBias: number
}

const sentimentColor = (s: string) => {
  if (s === 'Bullish') return 'bg-[#00ff88] text-black'
  if (s === 'Bearish') return 'bg-[#ff3b3b] text-white'
  return 'bg-[#888888] text-white'
}

export default function SmartMoneyPage() {
  const [tiers, setTiers] = useState<TierData[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/smart-money')
        if (res.ok) {
          const data = await res.json()
          setTiers(data.tiers || [])
        }
      } catch {
        // Will retry
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return (
    <div>
      <TopBar title="Smart Money" />
      <div className="px-4 py-4 lg:px-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold mb-1">Wallet Groups by Perp Equity</h2>
          <p className="text-[#888888] text-xs">Aggregated positioning data across trader tiers</p>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : tiers.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {tiers.map((tier, i) => (
              <motion.div
                key={tier.name}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="card p-4"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{tier.emoji}</span>
                    <span className="font-semibold">{tier.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[#888888] text-xs">{tier.count.toLocaleString()}</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${sentimentColor(tier.sentiment)}`}>
                      {tier.sentiment}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-[#888888]">In Pos:</span>
                    <span>{tier.inPosition}%</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-[#888888]">Long Ratio:</span>
                    <span>{tier.longRatio}%</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-[#888888]">Net Bias:</span>
                    <span className={tier.netBias >= 0 ? 'text-[#00ff88]' : 'text-[#ff3b3b]'}>
                      ${Math.abs(tier.netBias).toLocaleString()}
                    </span>
                  </div>

                  {/* Long/Short bar */}
                  <div className="h-1.5 bg-[#222222] rounded-full overflow-hidden mt-1">
                    <div
                      className="h-full bg-[#00ff88] rounded-full"
                      style={{ width: `${tier.longRatio}%` }}
                    />
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="card p-6 text-center">
            <p className="text-[#888888] text-sm">No wallet data available yet. Seed wallets first.</p>
          </div>
        )}
      </div>
    </div>
  )
}
