'use client'
import { useState } from 'react'
import { TopBar } from '@/components/layout/TopBar'
import { AlertFeed, AlertItem } from '@/components/alerts/AlertFeed'
import { AlertConfig } from '@/components/alerts/AlertConfig'

type Tab = 'feed' | 'settings'

export default function AlertsPage() {
  const [tab, setTab] = useState<Tab>('feed')
  const [alerts] = useState<AlertItem[]>([])

  const handleSaveConfig = async (config: { telegramChatId: string; ntfyTopic: string; minPositionSize: number; archetypesFilter: string[] }) => {
    // In production, this would save to Supabase
    console.log('Saving alert config:', config)
    alert('Alert settings saved! Configure your Supabase credentials to persist settings.')
  }

  return (
    <div>
      <TopBar title="Alerts" />
      <div className="px-4 py-4 lg:px-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold mb-1">Alert Center</h2>
          <p className="text-[#888888] text-xs">Real-time alerts when tracked wallets make moves</p>
        </div>

        <div className="flex gap-2">
          {(['feed', 'settings'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                tab === t ? 'bg-[#00ff88] text-black' : 'bg-[#161616] text-[#888888]'
              }`}
            >
              {t === 'feed' ? 'Live Feed' : 'Settings'}
            </button>
          ))}
        </div>

        {tab === 'feed' && <AlertFeed alerts={alerts} loading={false} />}
        {tab === 'settings' && <AlertConfig onSave={handleSaveConfig} />}
      </div>
    </div>
  )
}
