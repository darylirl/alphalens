'use client'
import { motion } from 'framer-motion'
import Link from 'next/link'

// Honesty contract for this page: no invented trading data, ever. The only
// numbers shown are (a) real results from our published copy-trading
// backtests, or (b) obviously schematic shapes inside blocks explicitly
// captioned "Illustration". No fabricated wallets, PnL, or "live" claims.

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.1, duration: 0.5, ease: [0.25, 0.4, 0.25, 1] },
  }),
}

const features = [
  {
    num: '01',
    label: 'LIVE COHORT POSITIONING',
    title: 'See what tracked wallets are actually doing.',
    desc: 'Pulse aggregates the real fills of the classified cohort of tracked Hyperliquid wallets into a rolling 24-hour positioning view: long/short skew per coin, new positions versus additions, traded notional in USD. Captured from the exchange, never estimated, and honest about its own coverage.',
    href: '/pulse',
    cta: 'Open Pulse',
    href2: '/cohort',
    cta2: 'See the classified cohort',
  },
  {
    num: '02',
    label: 'HYPOTHESIS TESTING',
    title: 'Test ideas with real frictions before risking money.',
    desc: 'Every backtest on AlphaLens models the costs that kill strategies in practice: execution delay, slippage, and taker fees. We built this engine to test our own copy-trading thesis — and it failed. That engine is the product.',
    href: '/quant',
    cta: 'Try the sandbox',
  },
  {
    num: '03',
    label: 'VERIFIED VERDICTS',
    title: 'Verdicts you can share — including the failures.',
    desc: 'A tested idea gets a verdict with receipts: the full parameter set, the frictions applied, and the result. Failed hypotheses are first-class research here, because knowing what loses money is the cheapest edge there is.',
    href: '/research/copy-trading-autopsy',
    cta: 'Read our copy-trading autopsy',
  },
]

const steps = [
  { num: '01', title: 'Watch the cohort', desc: 'Pulse shows real aggregated positioning from captured fills. Form a hypothesis from what wallets do, not what anyone claims.' },
  { num: '02', title: 'Test with frictions', desc: 'Run the idea through the backtester with delay, slippage, and fees included. No cost-free fantasy results. The full verification engine behind our published verdicts opens to user hypotheses soon.' },
  { num: '03', title: 'Keep the verdict', desc: 'Win or lose, the result is the asset. We publish our failures with the same weight as our wins.' },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0F1A1E] overflow-hidden">
      {/* Hero */}
      <section className="relative pt-16 pb-12 px-6 lg:pt-28 lg:pb-20">
        {/* Ambient bg */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] rounded-full bg-[#0F1A1E] opacity-[0.06] blur-[120px]" />
          <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] rounded-full bg-[#34EAB9] opacity-[0.04] blur-[100px]" />
        </div>

        <div className="max-w-4xl mx-auto text-center relative z-10">
          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.25, 0.4, 0.25, 1] }}
            className="font-display italic font-normal text-4xl md:text-6xl lg:text-[84px] lg:leading-[92px] tracking-tight mb-6 text-white"
          >
            Stop copy trading. Start knowing.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.5 }}
            className="text-white/40 text-base md:text-lg max-w-2xl mx-auto mb-8 leading-relaxed"
          >
            We replayed 28,318 smart-money trades with real frictions to test
            the promise every terminal sells. It lost money. AlphaLens is the
            place to test your ideas before they cost you — on real
            Hyperliquid data, with the costs included.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.4 }}
          >
            <Link
              href="/pulse"
              className="inline-block bg-[#34EAB9] text-[#0F1A1E] font-semibold text-sm px-8 py-3.5 rounded hover:brightness-110 transition-all duration-150"
            >
              Launch App
            </Link>
          </motion.div>

          {/* The real evidence row — every number here comes from our two
              published backtest runs (backtest_results/ in the repo). */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.5 }}
            className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-3 max-w-3xl mx-auto"
          >
            <div className="bg-[#0F1A1E] border border-white/[0.08] rounded-lg p-4 text-left">
              <p className="text-[10px] text-white/40 mb-1">Copy-trades we replayed</p>
              <p className="font-mono text-lg font-bold text-[#F0FAF8]">28,318</p>
              <p className="text-[11px] text-white/55 mt-1">13 months of history, two independent cohorts</p>
            </div>
            <div className="bg-[#0F1A1E] border border-white/[0.08] rounded-lg p-4 text-left">
              <p className="text-[10px] text-white/40 mb-1">Frictions we modeled</p>
              <p className="font-mono text-lg font-bold text-[#F0FAF8]">3</p>
              <p className="text-[11px] text-white/55 mt-1">60s delay · 5 bps slippage · 0.045% taker per side</p>
            </div>
            <div className="bg-[#0F1A1E] border border-white/[0.08] rounded-lg p-4 text-left">
              <p className="text-[10px] text-white/40 mb-1">The verdict</p>
              <p className="font-mono text-lg font-bold text-[#FF3B5C]">Negative</p>
              <p className="text-[11px] text-white/55 mt-1">Gross was negative before a single fee</p>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.4 }}
            className="mt-4"
          >
            <Link
              href="/research/copy-trading-autopsy"
              className="text-xs text-[#34EAB9] font-medium hover:underline"
            >
              Read the full autopsy: 28,000 smart-money trades, replayed →
            </Link>
          </motion.div>

          {/* Product illustration */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.7, ease: [0.25, 0.4, 0.25, 1] }}
            className="mt-10 relative"
          >
            <div className="bg-[#0F1A1E] border border-white/[0.08] rounded-lg overflow-hidden shadow-2xl shadow-[#34EAB9]/5">
              <div className="flex items-center gap-2 px-4 py-3 bg-[#0F1A1E] border-b border-white/[0.08]">
                <div className="w-2.5 h-2.5 rounded-full bg-[#FF3B5C] opacity-60" />
                <div className="w-2.5 h-2.5 rounded-full bg-white/40 opacity-40" />
                <div className="w-2.5 h-2.5 rounded-full bg-[#34EAB9] opacity-40" />
                <div className="flex-1 ml-3 bg-[#0F1A1E] rounded px-3 py-1 text-[10px] font-mono text-white/40">
                  /pulse
                </div>
                <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-white/[0.06] text-white/40">
                  Illustration
                </span>
              </div>
              {/* Schematic pulse view: shapes only, no invented figures */}
              <div className="p-6 space-y-3">
                {[
                  { coin: 'Coin A', long: 62 },
                  { coin: 'Coin B', long: 48 },
                  { coin: 'Coin C', long: 55 },
                ].map(row => (
                  <div key={row.coin} className="bg-[#0F1A1E] border border-white/[0.08] rounded p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-white/70">{row.coin}</span>
                      <span className="text-[9px] text-white/30 font-mono">24h skew</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-[#34EAB9] w-8">{row.long}%L</span>
                      <div className="flex-1 h-1.5 bg-[#FF3B5C]/30 rounded-full overflow-hidden">
                        <div className="h-full bg-[#34EAB9] rounded-full" style={{ width: `${row.long}%` }} />
                      </div>
                      <span className="text-[10px] text-[#FF3B5C] w-8 text-right">{100 - row.long}%S</span>
                    </div>
                  </div>
                ))}
                <p className="text-center text-[9px] text-white/30 pt-1">
                  Illustration — the live view at /pulse renders only captured data
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Why we exist */}
      <section className="border-y border-white/[0.08] bg-[#0F1A1E]">
        <div className="max-w-4xl mx-auto px-6 py-12">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeUp}
            custom={0}
            className="text-center"
          >
            <h2 className="font-display text-2xl md:text-3xl font-medium tracking-tight text-[#F0FAF8] mb-3">
              Every terminal sells the same promise
            </h2>
            <p className="text-sm text-white/55 max-w-2xl mx-auto leading-relaxed">
              Follow smart money and win. We tested that promise with our own
              replay engine: full fill histories, verified complete, executed
              with the delay, slippage, and fees a real copier pays. The
              aggregate edge was not there. So we built the opposite product —
              one where claims come with receipts, failed ideas are published,
              and nothing is sold as a signal.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      {features.map((f, i) => (
        <section key={f.num} className="bg-[#0F1A1E]">
          <div className="max-w-5xl mx-auto px-6 py-14 lg:py-20">
            <motion.div
              custom={0}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-100px' }}
              variants={fadeUp}
            >
              <p className="font-mono text-[11px] tracking-widest text-white/40 mb-4">
                {f.num} — {f.label}
              </p>
            </motion.div>
            <div className={`grid lg:grid-cols-2 gap-12 items-center ${i % 2 !== 0 ? 'lg:grid-flow-dense' : ''}`}>
              <motion.div
                custom={1}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-100px' }}
                variants={fadeUp}
                className={i % 2 !== 0 ? 'lg:col-start-2' : ''}
              >
                <h2 className="font-display text-2xl md:text-3xl font-medium tracking-tight mb-4 text-[#F0FAF8]">
                  {f.title}
                </h2>
                <p className="text-white/55 leading-relaxed text-sm md:text-base mb-5">
                  {f.desc}
                </p>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <Link href={f.href} className="text-[#34EAB9] text-sm font-medium hover:underline">
                    {f.cta} →
                  </Link>
                  {'href2' in f && f.href2 && (
                    <Link href={f.href2} className="text-white/55 text-sm font-medium hover:text-[#34EAB9] hover:underline transition-colors">
                      {f.cta2} →
                    </Link>
                  )}
                </div>
              </motion.div>
              <motion.div
                custom={2}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-100px' }}
                variants={fadeUp}
                className={i % 2 !== 0 ? 'lg:col-start-1 lg:row-start-1' : ''}
              >
                <div className="bg-[#0F1A1E] border border-white/[0.08] rounded-lg p-5 relative">
                  <span className="absolute top-3 right-3 text-[9px] font-mono px-2 py-0.5 rounded bg-white/[0.06] text-white/40">
                    Illustration
                  </span>
                  {i === 0 && (
                    <div className="space-y-3 pt-4">
                      {[70, 45, 58].map((pct, j) => (
                        <div key={j} className="flex items-center gap-2">
                          <div className="w-10 h-3 rounded bg-white/[0.08]" />
                          <div className="flex-1 h-2 bg-[#FF3B5C]/25 rounded-full overflow-hidden">
                            <div className="h-full bg-[#34EAB9]/70 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      ))}
                      <p className="text-[9px] text-white/30 text-center pt-1">
                        Long/short skew per coin, from captured fills
                      </p>
                    </div>
                  )}
                  {i === 1 && (
                    <div className="space-y-2 pt-4 font-mono text-[10px]">
                      <div className="flex items-center gap-2">
                        <span className="text-[#34EAB9]">HYPOTHESIS</span>
                        <span className="bg-white/[0.06] rounded px-2 py-0.5 text-white/60">your idea, stated precisely</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[#34EAB9]">FRICTIONS</span>
                        <span className="bg-white/[0.06] rounded px-2 py-0.5 text-white/60">delay + slippage + fees</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[#34EAB9]">KILL CRITERIA</span>
                        <span className="bg-white/[0.06] rounded px-2 py-0.5 text-white/60">defined before the run</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[#FF3B5C]">VERDICT</span>
                        <span className="bg-white/[0.06] rounded px-2 py-0.5 text-white/60">whatever the data says</span>
                      </div>
                    </div>
                  )}
                  {i === 2 && (
                    <div className="space-y-3 pt-4">
                      <div className="bg-[#0F1A1E] rounded p-3 border border-[#34EAB9]/20">
                        <div className="w-16 h-2.5 rounded bg-[#34EAB9]/50 mb-2" />
                        <div className="w-full h-2 rounded bg-white/[0.06] mb-1" />
                        <div className="w-3/4 h-2 rounded bg-white/[0.06]" />
                      </div>
                      <div className="bg-[#0F1A1E] rounded p-3 border border-[#FF3B5C]/20">
                        <div className="w-16 h-2.5 rounded bg-[#FF3B5C]/50 mb-2" />
                        <div className="w-full h-2 rounded bg-white/[0.06] mb-1" />
                        <div className="w-2/3 h-2 rounded bg-white/[0.06]" />
                      </div>
                      <p className="text-[9px] text-white/30 text-center">
                        Passed and failed verdicts, equal visual weight
                      </p>
                    </div>
                  )}
                </div>
              </motion.div>
            </div>
          </div>
        </section>
      ))}

      {/* How it works */}
      <section className="bg-[#0F1A1E]">
        <div className="max-w-5xl mx-auto px-6 py-14">
          <motion.p
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeUp}
            custom={0}
            className="font-mono text-[11px] tracking-widest text-white/40 mb-4 text-center"
          >
            HOW IT WORKS
          </motion.p>
          <div className="grid md:grid-cols-3 gap-4 mt-8">
            {steps.map((s, i) => (
              <motion.div
                key={s.num}
                custom={i + 1}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={fadeUp}
                className="bg-[#0F1A1E] border border-white/[0.08] rounded-lg p-6"
              >
                <p className="font-mono text-[11px] text-[#34EAB9] mb-3">{s.num}</p>
                <h3 className="font-display font-medium text-[#F0FAF8] mb-2">{s.title}</h3>
                <p className="text-sm text-white/55 leading-relaxed">{s.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-[#0F1A1E] border-t border-white/[0.08]">
        <div className="max-w-3xl mx-auto text-center px-6 py-24">
          <motion.h2
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeUp}
            custom={0}
            className="font-display text-3xl md:text-4xl font-medium tracking-tight text-[#F0FAF8] mb-8"
          >
            Every claim ships with receipts. Including ours.
          </motion.h2>
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeUp}
            custom={1}
          >
            <Link
              href="/pulse"
              className="inline-block bg-[#34EAB9] text-[#0F1A1E] font-semibold text-sm px-8 py-3.5 rounded hover:brightness-110 transition-all duration-150"
            >
              Launch Alpha Lens
            </Link>
          </motion.div>
          <motion.p
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeUp}
            custom={2}
            className="text-white/40 text-xs mt-6"
          >
            Built on Hyperliquid. Nothing here is financial advice — we show
            you the data and the costs, and the decision stays yours.
          </motion.p>
        </div>
      </section>
    </div>
  )
}
