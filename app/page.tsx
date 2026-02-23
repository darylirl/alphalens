'use client'
import { motion } from 'framer-motion'
import Image from 'next/image'
import Link from 'next/link'

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
    label: 'WALLET INTELLIGENCE',
    title: 'Decode any trader on Hyperliquid.',
    desc: 'Real-time behavioral analysis of on-chain activity. See positions, PnL, leverage patterns, and trading style — all from a single wallet address. Understand what the best traders are doing before the market reacts.',
  },
  {
    num: '02',
    label: 'STRATEGY CLUSTERING',
    title: 'Wallets grouped by trading DNA.',
    desc: 'Our algorithms classify every active wallet into behavioral archetypes — scalpers, momentum traders, delta-neutral farmers, market makers. Spot patterns across thousands of wallets instantly.',
  },
  {
    num: '03',
    label: 'QUANT FRAMEWORK',
    title: 'Build strategies from real signals.',
    desc: 'Turn wallet intelligence into systematic edge. Define entry rules, risk parameters, and backtest against historical Hyperliquid data. Copy trade the wallets that match your thesis.',
  },
]

const steps = [
  { num: '01', title: 'Input a wallet', desc: 'Paste any Hyperliquid address or browse our discovered wallets.' },
  { num: '02', title: 'See behavioral patterns', desc: 'Archetype classification, confidence scoring, and PnL breakdown.' },
  { num: '03', title: 'Build your strategy', desc: 'Copy trade, set alerts, or create rules from the patterns you find.' },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0F1A1E] overflow-hidden">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#0F1A1E]/80 backdrop-blur-xl border-b border-white/[0.08]">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
          <Image src="/logo.png" alt="AlphaLens" width={140} height={36} className="h-8 w-auto" />
          <Link
            href="/dashboard"
            className="text-sm font-medium px-5 py-2 rounded border border-[#34EAB9] text-[#34EAB9] hover:bg-[#34EAB9] hover:text-[#0F1A1E] transition-all duration-150"
          >
            Launch App
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-32 pb-20 px-6 lg:pt-44 lg:pb-32">
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
            Intelligence layer for
            <br />
            Hyperliquid traders
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.5 }}
            className="text-white/55 text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed"
          >
            Analyze wallet behavior, decode trading strategies, and build systematic edge from real on-chain activity.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.4 }}
          >
            <Link
              href="/dashboard"
              className="inline-block bg-[#34EAB9] text-[#0F1A1E] font-semibold text-sm px-8 py-3.5 rounded hover:brightness-110 transition-all duration-150"
            >
              Launch App
            </Link>
          </motion.div>

          {/* Product mockup */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.7, ease: [0.25, 0.4, 0.25, 1] }}
            className="mt-16 relative"
          >
            <div className="bg-[#0F1A1E] border border-white/[0.08] rounded-lg overflow-hidden shadow-2xl shadow-[#34EAB9]/5">
              {/* Fake browser chrome */}
              <div className="flex items-center gap-2 px-4 py-3 bg-[#0F1A1E] border-b border-white/[0.08]">
                <div className="w-2.5 h-2.5 rounded-full bg-[#FF3B5C] opacity-60" />
                <div className="w-2.5 h-2.5 rounded-full bg-white/40 opacity-40" />
                <div className="w-2.5 h-2.5 rounded-full bg-[#34EAB9] opacity-40" />
                <div className="flex-1 ml-3 bg-[#0F1A1E] rounded px-3 py-1 text-[10px] font-mono text-white/40">
                  app.alphalens.io/dashboard
                </div>
              </div>
              {/* Dashboard preview */}
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-4 gap-3">
                  {['24h Volume', 'Open Interest', 'Top Gainer', 'Tracked'].map((label, i) => (
                    <div key={label} className="bg-[#0F1A1E] border border-white/[0.08] rounded p-3">
                      <p className="text-[9px] text-white/40 mb-1">{label}</p>
                      <p className="font-mono text-sm font-semibold text-[#F0FAF8]">
                        {['$4.28B', '$2.91B', 'HYPE', '847'][i]}
                      </p>
                      {i === 2 && <p className="text-[9px] font-mono text-[#34EAB9]">+18.4%</p>}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { addr: '0x7a23...e91f', pnl: '+$284,291', type: 'Momentum', s: '2.41' },
                    { addr: '0x3f8b...22a4', pnl: '+$156,830', type: 'Farmer', s: '1.87' },
                    { addr: '0xd1e4...cc07', pnl: '+$91,445', type: 'Scalper', s: '3.12' },
                  ].map(w => (
                    <div key={w.addr} className="bg-[#0F1A1E] border border-white/[0.08] rounded p-3">
                      <p className="font-mono text-[10px] text-white/55 mb-1">{w.addr}</p>
                      <p className="font-mono text-sm font-semibold text-[#34EAB9]">{w.pnl}</p>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[8px] px-1.5 py-0.5 rounded bg-[#0F1A1E] text-[#34EAB9]">{w.type}</span>
                        <span className="font-mono text-[9px] text-white/55">Sharpe {w.s}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Stats strip */}
      <section className="border-y border-white/[0.08] bg-[#0F1A1E]">
        <div className="max-w-4xl mx-auto flex items-center justify-center gap-12 md:gap-20 px-6 py-5">
          {[
            { num: '10K+', label: 'Wallets Analyzed' },
            { num: '$4.2B', label: 'Volume Tracked' },
            { num: '7', label: 'Archetype Models' },
          ].map(s => (
            <div key={s.label} className="text-center">
              <p className="font-mono text-lg font-bold text-[#34EAB9]">{s.num}</p>
              <p className="text-[11px] text-white/40 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      {features.map((f, i) => (
        <section
          key={f.num}
          className="bg-[#0F1A1E]"
        >
          <div className="max-w-5xl mx-auto px-6 py-20 lg:py-28">
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
                <p className="text-white/55 leading-relaxed text-sm md:text-base">
                  {f.desc}
                </p>
              </motion.div>
              <motion.div
                custom={2}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-100px' }}
                variants={fadeUp}
                className={i % 2 !== 0 ? 'lg:col-start-1 lg:row-start-1' : ''}
              >
                <div className="bg-[#0F1A1E] border border-white/[0.08] rounded-lg p-5">
                  {/* Feature visual placeholder based on section */}
                  {i === 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 bg-[#0F1A1E] rounded p-3 border border-white/[0.08]">
                        <div className="w-8 h-8 rounded bg-white/[0.06] flex items-center justify-center text-[#34EAB9] font-mono text-xs">#1</div>
                        <div className="flex-1">
                          <p className="font-mono text-xs text-[#F0FAF8]">0x7a23...e91f</p>
                          <p className="text-[9px] text-white/40">Momentum Trader</p>
                        </div>
                        <div className="text-right">
                          <p className="font-mono text-xs text-[#34EAB9]">+$284K</p>
                          <p className="font-mono text-[9px] text-white/55">71% win</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 bg-[#0F1A1E] rounded p-3 border border-white/[0.08]">
                        <div className="w-8 h-8 rounded bg-white/[0.06] flex items-center justify-center text-[#34EAB9] font-mono text-xs">#2</div>
                        <div className="flex-1">
                          <p className="font-mono text-xs text-[#F0FAF8]">0x3f8b...22a4</p>
                          <p className="text-[9px] text-white/40">Farmer (Delta-Neutral)</p>
                        </div>
                        <div className="text-right">
                          <p className="font-mono text-xs text-[#34EAB9]">+$156K</p>
                          <p className="font-mono text-[9px] text-white/55">Sharpe 1.87</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 bg-[#0F1A1E] rounded p-3 border border-white/[0.08]">
                        <div className="w-8 h-8 rounded bg-white/[0.06] flex items-center justify-center text-[#34EAB9] font-mono text-xs">#3</div>
                        <div className="flex-1">
                          <p className="font-mono text-xs text-[#F0FAF8]">0xd1e4...cc07</p>
                          <p className="text-[9px] text-white/40">Scalper</p>
                        </div>
                        <div className="text-right">
                          <p className="font-mono text-xs text-[#34EAB9]">+$91K</p>
                          <p className="font-mono text-[9px] text-white/55">3.12 Sharpe</p>
                        </div>
                      </div>
                    </div>
                  )}
                  {i === 1 && (
                    <div className="space-y-3">
                      {['Scalper', 'Momentum', 'Farmer', 'Market Maker', 'High Conv.'].map((type, j) => {
                        const w = [38, 28, 18, 10, 6][j]
                        return (
                          <div key={type} className="flex items-center gap-3">
                            <span className="text-[10px] text-white/55 w-24 flex-shrink-0">{type}</span>
                            <div className="flex-1 h-5 bg-white/[0.06] rounded overflow-hidden">
                              <div className="h-full bg-[#34EAB9] rounded opacity-60" style={{ width: `${w}%` }} />
                            </div>
                            <span className="font-mono text-[10px] text-white/40 w-10 text-right">{w}%</span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {i === 2 && (
                    <div className="space-y-3">
                      <div className="bg-[#0F1A1E] rounded p-3 border border-white/[0.08]">
                        <p className="font-mono text-[10px] text-white/40 mb-2">RULE BUILDER</p>
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2 text-[10px]">
                            <span className="text-[#34EAB9]">IF</span>
                            <span className="bg-white/[0.06] rounded px-2 py-0.5 text-[#F0FAF8]">whale_consensus</span>
                            <span className="text-white/40">&gt;</span>
                            <span className="font-mono text-[#34EAB9]">80%</span>
                          </div>
                          <div className="flex items-center gap-2 text-[10px]">
                            <span className="text-[#34EAB9]">AND</span>
                            <span className="bg-white/[0.06] rounded px-2 py-0.5 text-[#F0FAF8]">confidence</span>
                            <span className="text-white/40">&gt;=</span>
                            <span className="font-mono text-[#34EAB9]">7/10</span>
                          </div>
                          <div className="flex items-center gap-2 text-[10px]">
                            <span className="text-[#34EAB9]">THEN</span>
                            <span className="bg-white/[0.06] rounded px-2 py-0.5 text-[#F0FAF8]">enter_long</span>
                            <span className="text-white/40">size</span>
                            <span className="font-mono text-[#34EAB9]">2%</span>
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="bg-[#0F1A1E] rounded p-2 border border-white/[0.08] text-center">
                          <p className="font-mono text-sm text-[#34EAB9]">+47%</p>
                          <p className="text-[8px] text-white/40">Return</p>
                        </div>
                        <div className="bg-[#0F1A1E] rounded p-2 border border-white/[0.08] text-center">
                          <p className="font-mono text-sm text-[#F0FAF8]">2.3</p>
                          <p className="text-[8px] text-white/40">Sharpe</p>
                        </div>
                        <div className="bg-[#0F1A1E] rounded p-2 border border-white/[0.08] text-center">
                          <p className="font-mono text-sm text-[#F0FAF8]">-8%</p>
                          <p className="text-[8px] text-white/40">Max DD</p>
                        </div>
                      </div>
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
        <div className="max-w-5xl mx-auto px-6 py-20">
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
            Stop guessing. Start seeing.
          </motion.h2>
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeUp}
            custom={1}
          >
            <Link
              href="/dashboard"
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
            Built on Hyperliquid. Open and permissionless.
          </motion.p>
        </div>
      </section>
    </div>
  )
}
