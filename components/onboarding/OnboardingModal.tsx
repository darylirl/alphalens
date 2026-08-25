'use client'
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { X, TrendingUp, FlaskConical, Scale } from 'lucide-react'

const ONBOARDING_KEY = 'alphalens_onboarded'

// Honesty contract: no fabricated wallets, PnL, or activity anywhere in
// onboarding. Every number a new user sees must be real or absent; the
// journey introduces real surfaces (Pulse, the backtester, verdicts).
const steps = [
  {
    icon: TrendingUp,
    title: 'Start with what wallets actually do',
    subtitle: 'Pulse — live cohort positioning',
    content: (
      <div className="space-y-3">
        <div className="bg-[#0F1A1E] rounded-lg p-4 border border-white/[0.08] space-y-2.5">
          {[62, 47, 55].map((pct, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-8 h-2.5 rounded bg-white/[0.1]" />
              <div className="flex-1 h-1.5 bg-[#FF3B5C]/25 rounded-full overflow-hidden">
                <div className="h-full bg-[#34EAB9]/80 rounded-full" style={{ width: `${pct}%` }} />
              </div>
            </div>
          ))}
          <p className="text-[9px] text-white/30 text-center pt-1">Illustration</p>
        </div>
        <p className="text-xs text-white/55 leading-relaxed">
          Pulse aggregates the real fills of tracked Hyperliquid wallets into a
          rolling 24-hour view: long/short skew, new positions versus
          additions, notional in USD. Captured from the exchange — when
          capture is down, the page says so instead of showing stale numbers.
        </p>
        <Link href="/pulse" className="block text-center text-xs text-[#34EAB9] hover:underline">
          Open Pulse →
        </Link>
      </div>
    ),
  },
  {
    icon: FlaskConical,
    title: 'Test ideas before risking money',
    subtitle: 'Backtests with real frictions',
    content: (
      <div className="space-y-3">
        <div className="bg-[#0F1A1E] rounded-lg p-4 border border-white/[0.08] font-mono text-[10px] space-y-1.5">
          <p><span className="text-[#34EAB9]">FRICTIONS</span> <span className="text-white/60">delay · slippage · taker fees</span></p>
          <p><span className="text-[#34EAB9]">DATA</span> <span className="text-white/60">real Hyperliquid candles</span></p>
          <p><span className="text-[#FF3B5C]">VERDICT</span> <span className="text-white/60">whatever the data says</span></p>
        </div>
        <p className="text-xs text-white/55 leading-relaxed">
          We built this discipline for ourselves first: before shipping copy
          trading, we replayed 28,318 smart-money trades with real frictions.
          It lost money, so we removed the feature. Your ideas get the same
          honest treatment in the sandbox backtester.
        </p>
        <Link href="/quant" className="block text-center text-xs text-[#34EAB9] hover:underline">
          Try the backtester →
        </Link>
      </div>
    ),
  },
  {
    icon: Scale,
    title: 'Keep the verdict, either way',
    subtitle: 'Failures are research too',
    content: (
      <div className="space-y-3">
        <div className="bg-[#0F1A1E] rounded-lg p-4 border border-white/[0.08] space-y-2">
          <div className="rounded border border-[#34EAB9]/25 px-3 py-2">
            <div className="w-14 h-2 rounded bg-[#34EAB9]/50" />
          </div>
          <div className="rounded border border-[#FF3B5C]/25 px-3 py-2">
            <div className="w-14 h-2 rounded bg-[#FF3B5C]/50" />
          </div>
          <p className="text-[9px] text-white/30 text-center">Passed and failed — equal weight</p>
        </div>
        <p className="text-xs text-white/55 leading-relaxed">
          Every number on AlphaLens traces to a real source or an honest empty
          state — no invented wallets, no simulated recency, no signals sold
          as alpha. Read how we killed our own flagship feature in the Learn
          section.
        </p>
        <Link href="/learn" className="block text-center text-xs text-[#34EAB9] hover:underline">
          Read the copy-trading autopsy →
        </Link>
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
