import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, ArrowRight } from 'lucide-react'

// Honesty contract: every number in this post is verified against
// backtest_results/ (runs 1 and 2) and verification_results (job 4) before
// publication. Static content, no CMS, no database reads.

export const metadata: Metadata = {
  title: 'We replayed 28,000 smart money trades so you don’t have to — AlphaLens Research',
  description:
    'Two honest backtests of copy trading on Hyperliquid: 28,318 replayed trades, real frictions, net losses in both cohorts. The receipts, the method, and what actually survives.',
  openGraph: {
    title: 'We replayed 28,000 smart money trades so you don’t have to',
    description:
      'Copy trading the best Hyperliquid wallets loses money. 28,318 replayed trades with real frictions. Here are the receipts.',
    type: 'article',
    publishedTime: '2026-08-25',
    siteName: 'AlphaLens Research',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'We replayed 28,000 smart money trades so you don’t have to',
    description:
      'Copy trading the best Hyperliquid wallets loses money. 28,318 replayed trades with real frictions. The receipts.',
  },
}

function Stat({ label, value, sub, negative }: { label: string; value: string; sub?: string; negative?: boolean }) {
  return (
    <div className="bg-[#0F1A1E] border border-white/[0.08] rounded-lg p-4">
      <p className="text-[10px] text-white/40 mb-1">{label}</p>
      <p className={`font-mono text-lg font-bold ${negative ? 'text-[#FF3B5C]' : 'text-[#F0FAF8]'}`}>{value}</p>
      {sub && <p className="text-[11px] text-white/55 mt-1">{sub}</p>}
    </div>
  )
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg md:text-xl font-bold text-[#F0FAF8] mt-10 mb-4">{children}</h2>
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-white/70 leading-relaxed mb-4">{children}</p>
}

export default function CopyTradingAutopsyPage() {
  return (
    <div className="px-4 py-8 lg:px-6 max-w-2xl mx-auto">
      <Link href="/research" className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-[#34EAB9] transition-colors mb-6">
        <ArrowLeft size={12} /> Research
      </Link>

      <p className="text-[10px] font-mono text-[#FF3B5C] uppercase tracking-wider mb-2">Killed · August 25, 2026</p>
      <h1 className="text-2xl md:text-3xl font-bold text-[#F0FAF8] leading-tight mb-4">
        We replayed 28,000 smart money trades so you don&rsquo;t have to
      </h1>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 my-6">
        <Stat label="Copied trades replayed" value="28,318" sub="Two cohorts, 13 months" />
        <Stat label="Net result" value="&minus;$9,704" sub="After real frictions" negative />
        <Stat label="Gross, before any fee" value="&minus;$5,380" sub="No edge to eat" negative />
      </div>

      <P>
        Everyone on Hyperliquid sells you the same dream. Find the whales.
        Follow the smart money. Copy their trades and win.
      </P>
      <P>
        We built the tools to do exactly that. Wallet tracking, archetype
        classification, live feeds, the works. Then before telling anyone to
        use it, we did something the signal sellers never do. We tested
        whether it actually makes money.
      </P>
      <P>It doesn&rsquo;t. Here are the receipts.</P>

      <H2>Test one: copy the best wallets</H2>
      <P>
        We took our tracked universe of nearly 7,000 Hyperliquid wallets and
        selected the top 10 by 30-day Sharpe ratio. The best of the best by
        the metric everyone uses. Then we replayed their trades with honest
        frictions: a 60 second delay (you will never be faster than that),
        5 basis points of slippage, and real taker fees on every fill. Fixed
        USD 1,000 per trade.
      </P>
      <P>
        Nine of the ten wallets could not be copied at all. They are high
        frequency traders who never go flat, and the exchange only serves a
        few days of their history. There was no entry to mirror.
      </P>
      <P>
        The one wallet we could replay produced 7,499 copied trades. Win
        rate: 4.8 percent. Net result: a loss of USD 1,251 in under three
        days. And here is the detail that matters. The loss was not caused by
        fees. Gross profit was already negative USD 470 before a single fee
        was charged. The 60 second delay alone destroyed the edge, because a
        scalper&rsquo;s edge lives and dies inside the minute you arrive late to.
      </P>
      <P>
        Lesson one: the wallets that look best on the leaderboard are
        precisely the ones you cannot copy. High recent Sharpe on a perps
        exchange selects for high frequency traders, and their returns
        structurally cannot survive your delay.
      </P>

      <H2>Test two: copy the copyable wallets</H2>
      <P>
        Fine, we thought. Skip the scalpers. We rebuilt the cohort around
        copyability: swing and momentum wallets only, median holding time
        above four hours, fewer than 500 trades a month, and at least 90 days
        of verified complete history. Twenty one wallets qualified. We took
        the top ten and replayed thirteen months of their trading. Same
        frictions.
      </P>
      <P>
        28,318 copied trades. Net result: a loss of USD 9,704. Win rate 34.4
        percent. Maximum drawdown of USD 16,688 against a USD 10,000 capital
        base, which is a polite way of saying the strategy blows up.
      </P>
      <P>
        Once again the decomposition tells the real story. Gross was negative
        USD 5,380 before fees. This is not friction eating an edge. For
        wallets selected this way, there was no aggregate edge to eat.
      </P>
      <P>
        Monthly results flipped sign constantly with no trend. Three of the
        ten wallets were profitable, and the two big winners had completely
        opposite profiles: one a grinder winning 24 percent of trades, the
        other a sniper winning 63 percent. Two winners who agree on nothing
        is what luck looks like, not what a factor looks like.
      </P>
      <P>
        Lesson two: picking wallets by trailing performance is picking noise.
        Yesterday&rsquo;s Sharpe does not predict tomorrow&rsquo;s returns. Fund
        allocators have known this about human managers for decades. It is
        just as true for anonymous wallets.
      </P>

      <H2>What we verified before believing any of this</H2>
      <P>
        Every replayed trade reconciles to the penny. Entries land on real
        candle opens after the delay. Wallets whose history could not be
        validated back to a flat position were excluded rather than guessed
        at, and every exclusion is logged. When our fill model hit the limits
        of exchange candle retention, we disclosed exactly which granularity
        each trade used instead of pretending otherwise. The full methodology
        and every number in this post came out of a replay engine that
        refuses to fabricate data, and we are open sourcing it.
      </P>

      <H2>So what actually works?</H2>
      <P>
        Honestly: we don&rsquo;t fully know yet, and anyone who claims certainty
        is selling something. What we know is this. You cannot buy an edge by
        following someone else&rsquo;s trades. If an edge exists for a trader like
        you, it comes from an idea you have that others don&rsquo;t, tested
        honestly before your money touches it.
      </P>
      <P>
        That is what we are building. Not another terminal that shows you
        whales. A place where you state your hypothesis, we turn it into a
        precise test with real costs and pre-registered failure conditions,
        and the data gives you a verdict you can trust. Sometimes that
        verdict is no. A cheap, honest no is worth more than every signal you
        have ever paid for. These two dead backtests cost us nothing but
        compute. The same lessons cost most traders their account.
      </P>
      <P>
        The engine is not a promise. It scored its first live verdict this
        week: a cohort-flow strategy tested over 60 verified days, killed by
        its own pre-registered criteria at a loss of USD 66.55, with fees
        accounting for roughly half the damage. Then we ran the same test
        again on completely separate infrastructure and it reproduced the
        result to the cent. Every future verdict publishes to a public
        ledger, wins and losses alike, because a track record you curate is
        not a track record.
      </P>
      <P>
        The wallet data still matters, by the way. Not as trades to mirror,
        but as information: what hundreds of informed accounts are positioned
        in right now is a genuinely interesting input to your own thinking.
        We publish that view for free, live, from capture infrastructure
        recording every fill out of sample.
      </P>

      <p className="text-base font-semibold text-[#F0FAF8] mt-8 mb-6">
        Stop copy trading. Start knowing.
      </p>

      <div className="flex flex-col sm:flex-row gap-3 mb-10">
        <Link
          href="/pulse"
          className="flex-1 text-center bg-[#34EAB9] text-[#0F1A1E] font-semibold text-sm px-6 py-3 rounded hover:brightness-110 transition-all"
        >
          See live cohort positioning
        </Link>
        <Link
          href="/quant"
          className="flex-1 text-center border border-white/[0.12] text-[#F0FAF8] font-medium text-sm px-6 py-3 rounded hover:border-[#34EAB9] transition-colors"
        >
          Test your own idea
        </Link>
      </div>

      <div className="bg-[#0F1A1E] rounded-lg p-4 border border-[#34EAB9]/20">
        <p className="text-[#34EAB9] font-medium text-xs mb-1.5">Receipts</p>
        <p className="text-white/55 text-xs leading-relaxed">
          Every number above traces to per-trade CSVs published in the
          repository (<span className="font-mono">backtest_copy.py</span> and{' '}
          <span className="font-mono">backtest_results/</span>) and to the
          append-only verification ledger. The replay method, friction
          floors, and exclusion logs ship with the code.
        </p>
        <Link href="/learn#verification" className="inline-flex items-center gap-1 mt-2 text-[11px] text-[#34EAB9] font-medium hover:underline">
          How verification works <ArrowRight size={10} />
        </Link>
      </div>
    </div>
  )
}
