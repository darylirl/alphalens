'use client'
import { motion } from 'framer-motion'

export interface AlertItem {
  id: string
  walletAddress: string
  eventType: string
  asset: string
  side: string
  size: number
  price: number
  leverage: number
  triggeredAt: string
}

interface AlertFeedProps {
  alerts: AlertItem[]
  loading: boolean
}

export function AlertFeed({ alerts, loading }: AlertFeedProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card p-4 animate-pulse">
            <div className="w-32 h-4 bg-[#0D2E2A] rounded mb-2" />
            <div className="w-48 h-3 bg-[#0D2E2A] rounded" />
          </div>
        ))}
      </div>
    )
  }

  if (!alerts.length) {
    return (
      <div className="text-center py-12">
        <p className="text-[#8AADA9] text-sm">No alerts yet. Set up tracking to get started.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {alerts.map((alert, i) => {
        const isLong = alert.side === 'long' || alert.side === 'B'
        const shortAddr = `${alert.walletAddress.slice(0, 6)}...${alert.walletAddress.slice(-4)}`
        const time = new Date(alert.triggeredAt)
        const timeStr = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}`

        return (
          <motion.div
            key={alert.id}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            className="card p-3"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${isLong ? 'bg-[#34EAB9]' : 'bg-[#FF3B5C]'}`} />
                <div>
                  <p className="text-sm font-medium">
                    <span className="font-mono text-[#8AADA9]">{shortAddr}</span>
                    {' '}opened{' '}
                    <span className={isLong ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}>{isLong ? 'Long' : 'Short'}</span>
                    {' '}{alert.asset}
                  </p>
                  <p className="font-mono text-xs text-[#8AADA9] mt-0.5">
                    ${alert.size.toLocaleString()} @ ${alert.price.toLocaleString()} ({alert.leverage}x)
                  </p>
                </div>
              </div>
              <span className="font-mono text-xs text-[#8AADA9]">{timeStr}</span>
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}
