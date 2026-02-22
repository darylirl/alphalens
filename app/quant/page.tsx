'use client'
import { useState } from 'react'
import { TopBar } from '@/components/layout/TopBar'
import { OneClickStrategies } from '@/components/quant/OneClickStrategies'
import { RuleBuilder } from '@/components/quant/RuleBuilder'
import { BacktestResult } from '@/components/quant/BacktestResult'
import { motion } from 'framer-motion'

type Tab = 'templates' | 'builder' | 'active'

interface SavedRule {
  name: string
  walletConds: Record<string, unknown>
  marketConds: Record<string, unknown>
  paperPnl: number
  triggerCount: number
  isActive: boolean
}

export default function QuantPage() {
  const [tab, setTab] = useState<Tab>('templates')
  const [savedRules, setSavedRules] = useState<SavedRule[]>([])
  const [backtestData, setBacktestData] = useState<{ data: Array<{ date: string; pnl: number }>; totalPnl: number; winRate: number; tradeCount: number; sharpe: number } | null>(null)

  const handleTemplateSelect = (template: Record<string, unknown>) => {
    // Generate mock backtest data
    const days = 30
    let cumPnl = 0
    const data = Array.from({ length: days }, (_, i) => {
      const change = (Math.random() - 0.4) * 500
      cumPnl += change
      return {
        date: new Date(Date.now() - (days - i) * 86400000).toISOString().split('T')[0],
        pnl: Math.round(cumPnl)
      }
    })
    setBacktestData({
      data,
      totalPnl: Math.round(cumPnl),
      winRate: 0.62,
      tradeCount: 47,
      sharpe: 1.34
    })
  }

  const handleRuleSave = (rule: Record<string, unknown>) => {
    setSavedRules(prev => [...prev, {
      name: rule.name as string,
      walletConds: rule.walletConds as Record<string, unknown>,
      marketConds: rule.marketConds as Record<string, unknown>,
      paperPnl: 0,
      triggerCount: 0,
      isActive: true
    }])
    setTab('active')
  }

  return (
    <div>
      <TopBar title="Pocket Quant" />
      <div className="px-4 py-4 lg:px-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold mb-1">Pocket Quant Builder</h2>
          <p className="text-[#888888] text-xs">Build rules that watch wallets and alert you. No code needed.</p>
        </div>

        <div className="flex gap-2">
          {(['templates', 'builder', 'active'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                tab === t ? 'bg-[#00ff88] text-black' : 'bg-[#161616] text-[#888888]'
              }`}
            >
              {t === 'templates' ? 'Templates' : t === 'builder' ? 'Custom' : `Active (${savedRules.length})`}
            </button>
          ))}
        </div>

        {tab === 'templates' && (
          <div className="space-y-4">
            <OneClickStrategies onSelect={handleTemplateSelect} />
            {backtestData && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                <h3 className="text-sm font-semibold mb-3">Backtest Preview</h3>
                <BacktestResult {...backtestData} />
              </motion.div>
            )}
          </div>
        )}

        {tab === 'builder' && <RuleBuilder onSave={handleRuleSave} />}

        {tab === 'active' && (
          <div className="space-y-3">
            {savedRules.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-[#888888] text-sm mb-3">No active rules yet</p>
                <button onClick={() => setTab('templates')} className="text-[#00ff88] text-sm font-medium">
                  Start with a template
                </button>
              </div>
            ) : (
              savedRules.map((rule, i) => (
                <div key={i} className="card p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-semibold text-sm">{rule.name}</p>
                    <div className={`w-2 h-2 rounded-full ${rule.isActive ? 'bg-[#00ff88] pulse-green' : 'bg-[#888888]'}`} />
                  </div>
                  <div className="flex gap-4 text-xs text-[#888888]">
                    <span>Paper PnL: <span className={rule.paperPnl >= 0 ? 'text-[#00ff88]' : 'text-[#ff3b3b]'}>${rule.paperPnl}</span></span>
                    <span>Triggers: {rule.triggerCount}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
