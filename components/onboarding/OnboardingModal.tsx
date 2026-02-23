'use client'
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { X, ChevronRight, Crosshair, TrendingUp, Bell, DollarSign } from 'lucide-react'

const ONBOARDING_KEY = 'alphalens_onboarded'

const steps = [
  {
    icon: Crosshair,
    title: 'Discover Top Traders',
    subtitle: 'Meet a proven performer',
    content: (
      <div className="space-y-3">
        <div className="bg-[#0F1A1E] rounded-lg p-4 border border-white/[0.08]">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-[#34EAB920] flex items-center justify-center text-[#34EAB9] font-mono text-sm font-bold">#1</div>
            <div>
              <p className="font-mono text-sm text-[#F0FAF8]">0x7a23...e91f</p>
              <p className="text-[10px] text-white/40">Momentum Trader &middot; 847 trades</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="font-mono text-sm font-bold text-[#34EAB9]">+$284K</p>
              <p className="text-[9px] text-white/40">Total PnL</p>
            </div>
            <div>
              <p className="font-mono text-sm font-bold">71%</p>
              <p className="text-[9px] text-white/40">Win Rate</p>
            </div>
            <div>
              <p className="font-mono text-sm font-bold">2.41</p>
              <p className="text-[9px] text-white/40">Sharpe</p>
            </div>
          </div>
        </div>
        <p className="text-xs text-white/55 leading-relaxed">
          Alpha Lens analyzes thousands of wallets on Hyperliquid. We surface the ones with real, consistent edge — not just one lucky trade.
        </p>
      </div>
    ),
  },
  {
    icon: TrendingUp,
    title: 'See What You Could Have Made',
    subtitle: '7-day hypothetical return',
    content: (
      <div className="space-y-3">
        <div className="bg-[#0F1A1E] rounded-lg p-4 border border-white/[0.08]">
          <p className="text-[10px] text-white/40 mb-2">If you followed this wallet at 25% ratio for 7 days:</p>
          <div className="space-y-2">
            {[
              { asset: 'ETH Long', pnl: '+$1,420', time: '3d ago' },
              { asset: 'BTC Long', pnl: '+$890', time: '5d ago' },
              { asset: 'SOL Short', pnl: '+$340', time: '6d ago' },
              { asset: 'ARB Long', pnl: '-$120', time: '7d ago' },
            ].map(t => (
              <div key={t.asset} className="flex items-center justify-between text-xs">
                <span className="text-[#F0FAF8]">{t.asset}</span>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-white/40">{t.time}</span>
                  <span className={`font-mono font-semibold ${t.pnl.startsWith('+') ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>{t.pnl}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-white/[0.08] flex justify-between">
            <span className="text-xs text-white/55">Hypothetical 7d return</span>
            <span className="font-mono text-sm font-bold text-[#34EAB9]">+$2,530</span>
          </div>
        </div>
        <p className="text-xs text-white/55 leading-relaxed">
          Past performance doesn&apos;t guarantee future results, but it shows the kind of edge available when you follow data instead of guessing.
        </p>
      </div>
    ),
  },
  {
    icon: Bell,
    title: 'Set Up Your First Alert',
    subtitle: 'Never miss a move',
    content: (
      <div className="space-y-3">
        <div className="bg-[#0F1A1E] rounded-lg p-4 border border-[#34EAB920]">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-[#34EAB9] pulse-accent" />
            <span className="text-xs font-medium text-[#34EAB9]">New Position Alert</span>
          </div>
          <p className="text-sm text-[#F0FAF8] mb-1">
            <span className="font-mono text-white/55">0x7a23...e91f</span> opened <span className="text-[#34EAB9]">Long ETH</span>
          </p>
          <p className="text-[10px] text-white/40">
            $75,000 @ $3,510 &middot; 5x leverage &middot; Just now
          </p>
          <div className="flex gap-2 mt-3">
            <div className="flex-1 text-center py-2 rounded text-xs font-semibold bg-[#34EAB9] text-[#0F1A1E]">
              Mirror Trade
            </div>
            <div className="py-2 px-3 rounded text-xs text-white/55 border border-white/[0.12]">
              Dismiss
            </div>
          </div>
        </div>
        <p className="text-xs text-white/55 leading-relaxed">
          Get notified the moment top wallets make moves. Each alert includes context — wallet track record, trade details, and a one-tap action.
        </p>
      </div>
    ),
  },
  {
    icon: DollarSign,
    title: 'Start Your Journey',
    subtitle: 'From observer to systematic trader',
    content: (
      <div className="space-y-4">
        <p className="text-sm text-[#F0FAF8] leading-relaxed">
          Alpha Lens turns you from a passive observer into a systematic trader with a feedback loop.
        </p>
        <div className="space-y-2">
          {[
            { step: '1', label: 'Explore', desc: 'Browse the Alpha Hunters leaderboard', href: '/hunters' },
            { step: '2', label: 'Follow', desc: 'Add top wallets to your watchlist', href: '/watchlist' },
            { step: '3', label: 'Alert', desc: 'Set up signals for wallet moves', href: '/alerts' },
            { step: '4', label: 'Execute', desc: 'Copy trade or act on signals', href: '/copy-trade' },
            { step: '5', label: 'Learn', desc: 'Track your performance and iterate', href: '/performance' },
          ].map(s => (
            <Link
              key={s.step}
              href={s.href}
              className="flex items-center gap-3 bg-[#0F1A1E] rounded-lg p-3 hover:bg-white/[0.06] transition-colors group"
            >
              <div className="w-6 h-6 rounded-full bg-[#34EAB920] flex items-center justify-center text-[#34EAB9] text-xs font-bold">{s.step}</div>
              <div className="flex-1">
                <p className="text-xs font-semibold">{s.label}</p>
                <p className="text-[10px] text-white/40">{s.desc}</p>
              </div>
              <ChevronRight size={14} className="text-white/40 group-hover:text-[#34EAB9] transition-colors" />
            </Link>
          ))}
        </div>
      </div>
    ),
  },
]

export function OnboardingModal() {
  const [show, setShow] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    const done = localStorage.getItem(ONBOARDING_KEY)
    if (!done) setShow(true)
  }, [])

  const dismiss = () => {
    localStorage.setItem(ONBOARDING_KEY, 'true')
    setShow(false)
  }

  const next = () => {
    if (step < steps.length - 1) setStep(step + 1)
    else dismiss()
  }

  if (!show) return null

  const current = steps[step]
  const Icon = current.icon
  const isLast = step === steps.length - 1

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center px-4"
        style={{ background: 'rgba(0,0,0,0.7)' }}
        onClick={dismiss}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="w-full max-w-md bg-[#0F1A1E] border border-white/[0.08] rounded-xl overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
            <div className="flex items-center gap-2">
              <Icon size={16} className="text-[#34EAB9]" />
              <div>
                <p className="text-sm font-semibold">{current.title}</p>
                <p className="text-[10px] text-white/40">{current.subtitle}</p>
              </div>
            </div>
            <button onClick={dismiss} className="p-1 text-white/40 hover:text-white/70 transition-colors">
              <X size={16} />
            </button>
          </div>

          {/* Content */}
          <div className="px-5 py-5">
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >
                {current.content}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-white/[0.08] flex items-center justify-between">
            {/* Step dots */}
            <div className="flex gap-1.5">
              {steps.map((_, i) => (
                <div
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${i === step ? 'bg-[#34EAB9]' : 'bg-white/20'}`}
                />
              ))}
            </div>

            <div className="flex gap-2">
              <button onClick={dismiss} className="text-xs text-white/40 hover:text-white/70 transition-colors px-3 py-2">
                Skip
              </button>
              <button
                onClick={next}
                className="text-xs font-semibold bg-[#34EAB9] text-[#0F1A1E] px-5 py-2 rounded hover:brightness-110 transition-all"
              >
                {isLast ? 'Get Started' : 'Next'}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
