'use client'
import { useSmartMoneyFeed } from '@/lib/hooks/useSmartMoneyFeed'
import { PulseIndicator } from '@/components/ui/PulseIndicator'
import { CopyableAddress } from '@/components/ui/CopyableAddress'
import { motion, AnimatePresence } from 'framer-motion'

export function SmartMoneyFeed() {
  const { status, trades, trackedCount } = useSmartMoneyFeed()

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold">Smart Money Feed</h3>
          <p className="text-[11px] text-white/40">
            {trackedCount > 0 ? `Monitoring ${trackedCount} wallets` : 'Real-time tracked wallet activity'}
          </p>
        </div>
        <PulseIndicator active={status === 'connected'} />
      </div>

      {trades.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-white/40 text-xs">
            {status === 'connecting' ? 'Connecting to live feed...' :
             status === 'connected' ? 'Waiting for smart money trades...' :
             'Feed disconnected — reconnecting...'}
          </p>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
          <AnimatePresence initial={false}>
            {trades.slice(0, 20).map((trade) => {
              const isBuy = trade.side === 'B'
              const notional = parseFloat(trade.px) * parseFloat(trade.sz)

              return (
                <motion.div
                  key={trade.id}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center justify-between py-1.5 px-2 rounded bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      isBuy ? 'bg-[#34EAB9]/15 text-[#34EAB9]' : 'bg-[#FF3B5C]/15 text-[#FF3B5C]'
                    }`}>
                      {isBuy ? 'BUY' : 'SELL'}
                    </span>
                    <span className="text-xs font-semibold text-[#F0FAF8]">{trade.coin}</span>
                    <span className="text-[11px] font-mono text-white/50">
                      ${notional >= 1000 ? `${(notional / 1000).toFixed(1)}K` : notional.toFixed(0)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {trade.wallets.slice(0, 1).map((addr) => (
                      <CopyableAddress key={addr} address={addr} mono className="text-[10px]" />
                    ))}
                    <span className="text-[10px] text-white/25 font-mono">
                      {new Date(trade.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
