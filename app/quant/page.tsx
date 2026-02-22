'use client'
import { useState } from 'react'
import { TopBar } from '@/components/layout/TopBar'
import { OneClickStrategies } from '@/components/quant/OneClickStrategies'
import { RuleBuilder } from '@/components/quant/RuleBuilder'
import { BacktestResult } from '@/components/quant/BacktestResult'
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
  const [backtestData, setBacktestData] = useState<{ data: Array<{ date: string; pnl: number }>; totalPnl: number; winRate: number; tradeCount: number; sharpe: number } | null>(null)

  const handleTemplateBacktest = (template: Record<string, unknown>) => {
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
    const dailyReturns = data.map((d, i) => i === 0 ? 0 : d.pnl - data[i - 1].pnl)
    const mean = dailyReturns.reduce((s, v) => s + v, 0) / dailyReturns.length
    const std = Math.sqrt(dailyReturns.reduce((s, v) => s + (v - mean) ** 2, 0) / dailyReturns.length) || 1

    setBacktestData({
      data,
      totalPnl: Math.round(cumPnl),
      winRate: 0.55 + Math.random() * 0.15,
      tradeCount: Math.floor(20 + Math.random() * 60),
      sharpe: Math.round((mean / std) * Math.sqrt(365) * 100) / 100
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
      <TopBar title="Pocket Quant" />
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
                <p className="text-white/55 text-sm mb-3">No active rules yet</p>
                <p className="text-white/40 text-xs mb-4">Create a rule from a template or build your own custom strategy</p>
                <div className="flex gap-3 justify-center">
                  <button onClick={() => setTab('templates')} className="text-sm font-medium bg-[#34EAB9] text-[#0F1A1E] px-4 py-2 rounded">
                    Browse Templates
                  </button>
                  <button onClick={() => setTab('builder')} className="text-sm font-medium bg-[#0F1A1E] text-white/55 px-4 py-2 rounded border border-white/[0.12]">
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
                        {rule.paperPnl >= 0 ? '+' : ''}${rule.paperPnl.toLocaleString()}
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
