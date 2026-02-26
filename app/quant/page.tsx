'use client'
import { useState } from 'react'
import { OneClickStrategies } from '@/components/quant/OneClickStrategies'
import { SimpleRuleBuilder } from '@/components/quant/SimpleRuleBuilder'
import { BacktestResult, type BacktestSignal } from '@/components/quant/BacktestResult'
import { motion } from 'framer-motion'
import { Trash2, Pause, Play } from 'lucide-react'

type Tab = 'templates' | 'builder' | 'active'

interface SavedRule {
  id: string
  name: string
  conditions: Record<string, unknown>
  paperPnl: number
  triggerCount: number
  isActive: boolean
  createdAt: number
}

export default function QuantPage() {
  const [tab, setTab] = useState<Tab>('templates')
  const [savedRules, setSavedRules] = useState<SavedRule[]>([])
  const [backtestData, setBacktestData] = useState<{ strategyName: string; data: Array<{ date: string; pnl: number }>; totalPnl: number; winRate: number; tradeCount: number; sharpe: number; maxDrawdown: number; signals: BacktestSignal[] } | null>(null)

  const handleTemplateBacktest = (template: Record<string, unknown>) => {
    const days = 90
    let cumPnl = 0
    let peak = 0
    let maxDd = 0
    const data = Array.from({ length: days }, (_, i) => {
      const change = (Math.random() - 0.4) * 500
      cumPnl += change
      if (cumPnl > peak) peak = cumPnl
      const dd = peak - cumPnl
      if (dd > maxDd) maxDd = dd
      return {
        date: new Date(Date.now() - (days - i) * 86400000).toISOString().split('T')[0],
        pnl: Math.round(cumPnl)
      }
    })
    const dailyReturns = data.map((d, i) => i === 0 ? 0 : d.pnl - data[i - 1].pnl)
    const mean = dailyReturns.reduce((s, v) => s + v, 0) / dailyReturns.length
    const std = Math.sqrt(dailyReturns.reduce((s, v) => s + (v - mean) ** 2, 0) / dailyReturns.length) || 1
    const tradeCount = Math.floor(20 + Math.random() * 60)

    const assets = ['ETH', 'BTC', 'SOL', 'HYPE', 'ARB']
    const mockSignals: BacktestSignal[] = Array.from({ length: 5 }, (_, i) => {
      const asset = assets[i % assets.length]
      const dir: 'Long' | 'Short' = Math.random() > 0.4 ? 'Long' : 'Short'
      const entry = asset === 'BTC' ? 62000 + Math.round(Math.random() * 5000) : asset === 'ETH' ? 3200 + Math.round(Math.random() * 400) : asset === 'SOL' ? 140 + Math.round(Math.random() * 30) : asset === 'HYPE' ? 25 + Math.round(Math.random() * 8) : 1.2 + Math.round(Math.random() * 0.4 * 100) / 100
      const pnlAmt = Math.round((Math.random() - 0.35) * 3000)
      const exit = dir === 'Long' ? entry + entry * (pnlAmt / 50000) : entry - entry * (pnlAmt / 50000)
      return {
        date: new Date(Date.now() - (i * 5 + Math.floor(Math.random() * 5)) * 86400000).toISOString().split('T')[0],
        asset,
        direction: dir,
        entry: Math.round(entry * 100) / 100,
        exit: Math.round(exit * 100) / 100,
        pnl: pnlAmt,
      }
    })

    setBacktestData({
      strategyName: template.name as string || 'Strategy',
      data,
      totalPnl: Math.round(cumPnl),
      winRate: 0.55 + Math.random() * 0.15,
      tradeCount,
      sharpe: Math.round((mean / std) * Math.sqrt(365) * 100) / 100,
      maxDrawdown: Math.round(maxDd),
      signals: mockSignals,
    })
  }

  const handleTemplateActivate = (template: Record<string, unknown>) => {
    const rule: SavedRule = {
      id: `rule_${Date.now()}`,
      name: template.name as string,
      conditions: template.conditions as Record<string, unknown>,
      paperPnl: Math.round((Math.random() - 0.3) * 2000),
      triggerCount: Math.floor(Math.random() * 15),
      isActive: true,
      createdAt: Date.now()
    }
    setSavedRules(prev => [...prev, rule])
    setTab('active')
  }

  const handleRuleSave = (rule: Record<string, unknown>) => {
    const saved: SavedRule = {
      id: `rule_${Date.now()}`,
      name: rule.name as string,
      conditions: { walletConds: rule.walletConds, marketConds: rule.marketConds },
      paperPnl: Math.round((Math.random() - 0.3) * 1500),
      triggerCount: Math.floor(Math.random() * 10),
      isActive: true,
      createdAt: Date.now()
    }
    setSavedRules(prev => [...prev, saved])
    setTab('active')
  }

  const toggleRule = (id: string) => {
    setSavedRules(prev => prev.map(r => r.id === id ? { ...r, isActive: !r.isActive } : r))
  }

  const deleteRule = (id: string) => {
    setSavedRules(prev => prev.filter(r => r.id !== id))
  }

  const activeCount = savedRules.filter(r => r.isActive).length

  return (
    <div>
      <div className="px-4 py-4 lg:px-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold mb-1">Pocket Quant Builder</h2>
          <p className="text-white/55 text-xs">Build rules that watch wallets and alert you. No code needed.</p>
        </div>

        <div className="flex gap-2">
          {(['templates', 'builder', 'active'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                tab === t ? 'bg-[#34EAB9] text-[#0F1A1E]' : 'bg-[#0F1A1E] text-white/55'
              }`}
            >
              {t === 'templates' ? 'Templates' : t === 'builder' ? 'Custom' : `Active (${activeCount})`}
            </button>
          ))}
        </div>

        {tab === 'templates' && (
          <div className="space-y-4">
            <OneClickStrategies onSelect={handleTemplateBacktest} onActivate={handleTemplateActivate} />
            {backtestData && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                <BacktestResult {...backtestData} />
              </motion.div>
            )}
          </div>
        )}

        {tab === 'builder' && <SimpleRuleBuilder onSave={handleRuleSave} />}

        {tab === 'active' && (
          <div className="space-y-3">
            {savedRules.length === 0 ? (
              <div className="text-center py-12">
                <h3 className="text-[#F0FAF8] text-base font-semibold mb-2">No active strategies yet.</h3>
                <p className="text-white/40 text-sm mb-6">Activate a template or build a custom rule to start receiving signals.</p>
                <div className="flex gap-3 justify-center">
                  <button onClick={() => setTab('templates')} className="text-sm font-semibold bg-[#34EAB9] text-[#0F1A1E] px-5 py-2.5 rounded hover:brightness-110 transition-all">
                    Browse Templates
                  </button>
                  <button onClick={() => setTab('builder')} className="text-sm font-medium text-white/55 px-5 py-2.5 rounded border border-white/[0.12] hover:border-white/[0.24] transition-colors">
                    Build Custom
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="card p-3 bg-[#0F1A1E]">
                  <div className="flex items-center justify-between text-xs text-white/55">
                    <span>{activeCount} active / {savedRules.length} total rules</span>
                    <span>Paper Portfolio: <span className={`font-mono ${savedRules.reduce((s, r) => s + r.paperPnl, 0) >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                      ${savedRules.reduce((s, r) => s + r.paperPnl, 0).toLocaleString()}
                    </span></span>
                  </div>
                </div>
                {savedRules.map((rule) => (
                  <motion.div
                    key={rule.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`card p-4 transition-all ${rule.isActive ? '' : 'opacity-60'}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${rule.isActive ? 'bg-[#34EAB9] pulse-accent' : 'bg-white/40'}`} />
                        <p className="font-semibold text-sm">{rule.name}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleRule(rule.id)}
                          className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors text-white/55 hover:text-[#F0FAF8]"
                          title={rule.isActive ? 'Pause' : 'Resume'}
                        >
                          {rule.isActive ? <Pause size={14} /> : <Play size={14} />}
                        </button>
                        <button
                          onClick={() => deleteRule(rule.id)}
                          className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors text-white/55 hover:text-[#FF3B5C]"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="flex gap-4 text-xs text-white/55">
                      <span>Paper PnL: <span className={`font-mono ${rule.paperPnl >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                        {rule.paperPnl >= 0 ? '+' : '-'}${Math.abs(rule.paperPnl).toLocaleString()}
                      </span></span>
                      <span>Triggers: <span className="font-mono">{rule.triggerCount}</span></span>
                      <span>{rule.isActive ? 'Running' : 'Paused'}</span>
                    </div>
                    <div className="mt-2 text-xs text-white/40">
                      Created {new Date(rule.createdAt).toLocaleDateString()}
                    </div>
                  </motion.div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
