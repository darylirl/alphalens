'use client'
import { Suspense, useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { AlertFeed, AlertItem } from '@/components/alerts/AlertFeed'
import { AlertConfig } from '@/components/alerts/AlertConfig'
import { ActiveSignalsFeed, type Signal } from '@/components/signals/ActiveSignalsFeed'
import { ConsensusAlerts, type ConsensusAlert } from '@/components/signals/ConsensusAlerts'
import { Bell, Activity, Users } from 'lucide-react'

type Tab = 'signals' | 'feed' | 'consensus' | 'settings'

export default function AlertsPage() {
  return (
    <Suspense fallback={<div className="px-4 py-8 text-center text-white/55 text-sm">Loading...</div>}>
      <AlertsContent />
    </Suspense>
  )
}

function AlertsContent() {
  const searchParams = useSearchParams()
  const walletParam = searchParams.get('wallet')
  const [tab, setTab] = useState<Tab>('signals')
  const [alerts] = useState<AlertItem[]>([])
  const [signals, setSignals] = useState<Signal[]>([])
  const [consensus, setConsensus] = useState<ConsensusAlert[]>([])

  useEffect(() => {
    async function loadSignals() {
      try {
        const res = await fetch('/api/signals')
        if (res.ok) {
          const json = await res.json()
          // API envelope is { success, data, count, consensus }
          setSignals(json.data || [])
          setConsensus(json.consensus || [])
        }
      } catch {
        // Signals not yet available
      }
    }
    loadSignals()
  }, [])

  return (
    <div>
      <div className="px-4 py-4 lg:px-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold mb-1">Alert Center</h2>
          <p className="text-white/55 text-xs">
            Real-time alerts when tracked wallets make moves
            {walletParam && (
              <span> &middot; Filtered for <span className="font-mono text-[#34EAB9]">{walletParam.slice(0, 6)}...{walletParam.slice(-4)}</span></span>
            )}
          </p>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {([
            { id: 'signals' as const, label: 'Live Signals', icon: Activity },
            { id: 'consensus' as const, label: 'Consensus', icon: Users },
            { id: 'feed' as const, label: 'Alert Log', icon: Bell },
            { id: 'settings' as const, label: 'Settings', icon: Bell },
          ]).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-colors whitespace-nowrap ${
                tab === t.id ? 'bg-[#34EAB9] text-[#0F1A1E]' : 'bg-[#0F1A1E] text-white/55'
              }`}
            >
              <t.icon size={12} />
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'signals' && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <ActiveSignalsFeed
              signals={walletParam ? signals.filter(s => s.wallet_address === walletParam.toLowerCase()) : signals}
            />
          </motion.div>
        )}

        {tab === 'consensus' && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <ConsensusAlerts alerts={consensus} />
          </motion.div>
        )}

        {tab === 'feed' && <AlertFeed alerts={alerts} loading={false} />}
        {tab === 'settings' && <AlertConfig />}
      </div>
    </div>
  )
}
