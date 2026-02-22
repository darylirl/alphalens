'use client'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, Crosshair, DollarSign, Copy, Zap, BarChart3, Users, TrendingUp, Shield, Target, Activity, Layers } from 'lucide-react'

interface SectionProps {
  id: string
  icon: React.ReactNode
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}

function Section({ id, icon, title, children, defaultOpen = false }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-[#222222] rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-[#161616] transition-colors"
      >
        <span className="text-[#00ff88]">{icon}</span>
        <span className="text-sm font-semibold flex-1">{title}</span>
        <ChevronDown size={16} className={`text-[#888888] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 space-y-4 text-sm text-[#cccccc] leading-relaxed">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Term({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#111111] rounded-xl p-4 border border-[#1a1a1a]">
      <p className="text-white font-medium mb-1.5">{name}</p>
      <p className="text-[#999999] text-xs leading-relaxed">{children}</p>
    </div>
  )
}

function Badge({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="inline-flex text-[11px] font-medium px-2.5 py-1 rounded-full mr-1.5 mb-1"
      style={{ color, backgroundColor: color + '20' }}
    >
      {label}
    </span>
  )
}

export default function LearnPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-2">
          Learn <span className="text-[#00ff88]">AlphaLens</span>
        </h1>
        <p className="text-[#888888] text-sm">
          Everything you need to understand the platform — trader archetypes, smart money signals,
          confidence scoring, and more.
        </p>
      </div>

      {/* Trader Archetypes */}
      <Section id="archetypes" icon={<Users size={18} />} title="Trader Archetypes" defaultOpen>
        <p>
          AlphaLens analyses on-chain trading patterns on Hyperliquid to classify wallets into behavioural archetypes.
          Each archetype represents a distinct trading style detected by our scoring algorithms.
        </p>

        <div className="grid gap-3">
          <Term name="Scalper">
            High-frequency traders who open and close positions rapidly, typically within minutes.
            They use high leverage ({'>'}10x) and trade very frequently ({'>'}50 trades in a window).
            Scalpers profit from small price movements and rely on volume.
            <div className="mt-2"><Badge color="#ff9500" label="Scalper" /></div>
          </Term>

          <Term name="Swing Trader">
            Medium-term traders who hold positions for hours to days, using moderate leverage (3-10x).
            They aim to capture larger price swings and typically make 10-50 trades per window.
            Swing traders often time entries around key support/resistance levels.
            <div className="mt-2"><Badge color="#007aff" label="Swing" /></div>
          </Term>

          <Term name="Momentum Trader">
            Traders who follow strong price trends. They enter when momentum is building and ride
            the wave. Typically hold for less than a day with above-average leverage. They are
            characterized by positive average PnL per trade.
            <div className="mt-2"><Badge color="#bf5af2" label="Momentum" /></div>
          </Term>

          <Term name="High Conviction">
            Traders who place fewer but larger bets. They make under 20 trades with average
            position sizes above $10,000 and low leverage (under 5x). These traders do deep
            research and put significant capital behind their ideas.
            <div className="mt-2"><Badge color="#00ff88" label="High Conv." /></div>
          </Term>

          <Term name="Funding Arb">
            Traders who exploit funding rate differences. They keep positions open with low
            leverage and low PnL variance, steadily collecting funding payments.
            Typically low trade frequency with consistent small gains.
            <div className="mt-2"><Badge color="#ffd60a" label="Funding Arb" /></div>
          </Term>

          <Term name="Farmer (Delta-Neutral)">
            Sophisticated traders who hold simultaneous long AND short positions across different
            assets to stay market-neutral (net exposure under 20% of total notional). They farm
            funding rates by being on the paying side of high-funding markets. Key signals: both-side
            positions, low leverage (under 3x), low PnL variance, and 4+ simultaneous positions.
            <div className="mt-2"><Badge color="#30d158" label="Farmer" /></div>
          </Term>

          <Term name="Market Maker">
            High-frequency traders who provide liquidity by placing both buy and sell orders on
            the same coins. They profit from the bid-ask spread. Key signals: two-sided trading
            on 2+ coins, 100+ trades, hold times under 5 minutes, and very tight PnL distribution.
            <div className="mt-2"><Badge color="#5ac8fa" label="Market Maker" /></div>
          </Term>
        </div>
      </Section>

      {/* Equity Tiers */}
      <Section id="tiers" icon={<Layers size={18} />} title="Equity Tiers (Wallet Size)">
        <p>
          Wallets are grouped into tiers based on their total account equity on Hyperliquid.
          Tier classification helps identify how much capital is behind a trading signal.
        </p>

        <div className="grid gap-3">
          <Term name="Leviathan — $1M+">
            The largest wallets on the platform. These are institutional-grade accounts
            or extremely successful individual traders. Their moves carry the most weight
            in confidence scoring. When Leviathans take a position, the market often follows.
          </Term>

          <Term name="Whale — $250K - $1M">
            Very large retail or small institutional accounts. Whales have significant
            market impact and their positions are closely watched. They represent serious
            capital commitment to their trades.
          </Term>

          <Term name="Shark — $50K - $250K">
            Experienced traders with substantial capital. Sharks are typically skilled traders
            who have grown their accounts through consistent performance. They often have
            the best risk-adjusted returns.
          </Term>

          <Term name="Fish — Under $50K">
            Smaller accounts that form the majority of traders. While individually less impactful,
            Fish in large numbers can signal retail sentiment shifts. High participation from Fish
            wallets on a token indicates broad retail interest.
          </Term>
        </div>
      </Section>

      {/* Smart Money & Confidence */}
      <Section id="smart-money" icon={<DollarSign size={18} />} title="Smart Money & Confidence Score">
        <p>
          The Smart Money page provides a token-centric view of what the smartest wallets on
          Hyperliquid are trading. Each token is assigned a <strong className="text-white">Confidence Score</strong> from
          0-10 based on four weighted factors.
        </p>

        <div className="grid gap-3">
          <Term name="Consensus (35%)">
            How aligned are traders on the direction? If 90% of wallets are long on a token,
            consensus is high. A 50/50 split means low consensus. This is the strongest signal
            — when smart money agrees, pay attention.
          </Term>

          <Term name="Liquidity (25%)">
            Total notional value of all positions on the token. Higher liquidity means more
            conviction behind the trade. Calculated as log-scaled total of long + short notional
            across all tracked wallets.
          </Term>

          <Term name="Participation (20%)">
            How many wallets are actively trading this token. More wallets = broader conviction.
            Calculated using a square-root scale so that each additional wallet has diminishing
            impact (prevents gaming).
          </Term>

          <Term name="Whale Alignment (20%)">
            Are the bigger wallets aligned with the direction? Leviathans are weighted 4x,
            Whales 3x, Sharks 2x, and Fish 1x. If Leviathans are all long but Fish are short,
            whale alignment is high for the long side.
          </Term>
        </div>

        <div className="bg-[#111111] rounded-xl p-4 border border-[#00ff8820]">
          <p className="text-white font-medium mb-2">Reading the Score</p>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div>
              <span className="text-[#00ff88] font-bold text-lg">8-10</span>
              <p className="text-[#999999] mt-1">Very high conviction. Strong agreement across large and small wallets with significant capital deployed.</p>
            </div>
            <div>
              <span className="text-[#ffd60a] font-bold text-lg">5-7</span>
              <p className="text-[#999999] mt-1">Moderate conviction. Mixed signals or limited participation. Worth monitoring but not a strong signal alone.</p>
            </div>
            <div>
              <span className="text-[#ff3b3b] font-bold text-lg">0-4</span>
              <p className="text-[#999999] mt-1">Low conviction. Disagreement among wallets, thin liquidity, or limited whale participation.</p>
            </div>
          </div>
        </div>
      </Section>

      {/* Asset Categories */}
      <Section id="categories" icon={<BarChart3 size={18} />} title="Asset Categories & Sectors">
        <p>
          Hyperliquid lists perpetual contracts across multiple asset classes. AlphaLens classifies
          them into sectors to help you spot thematic trends.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Term name="Major">
            Blue-chip cryptocurrencies like BTC, ETH, SOL, BNB. These are the most liquid and
            widely traded assets on the platform.
          </Term>
          <Term name="AI & Compute">
            AI-related tokens like RENDER, FET, NEAR, TAO. Tracks the AI narrative in crypto.
          </Term>
          <Term name="Meme">
            Meme coins like DOGE, SHIB, PEPE, WIF. Often driven by social sentiment and viral
            momentum rather than fundamentals.
          </Term>
          <Term name="DeFi">
            Decentralized finance tokens like UNI, AAVE, MKR, SNX. Tracks smart money interest
            in DeFi infrastructure.
          </Term>
          <Term name="L1 & L2">
            Layer 1 and Layer 2 blockchain tokens like AVAX, ARB, OP, SEI. Infrastructure plays
            that benefit from ecosystem growth.
          </Term>
          <Term name="Gaming & NFT">
            Gaming and metaverse tokens like AXS, IMX, GALA. Tracks interest in on-chain gaming.
          </Term>
          <Term name="Infrastructure">
            Protocol infrastructure tokens like LINK, GRT, PYTH. Backend services that power
            the broader crypto ecosystem.
          </Term>
          <Term name="Stock Perps">
            Perpetual contracts on stocks like NVDA, TSLA, AAPL (when available). Allows tracking
            smart money sentiment on traditional equities through crypto derivatives.
          </Term>
        </div>

        <p>
          Each sector gets a <strong className="text-white">narrative insight</strong> — an AI-generated summary
          of what smart money is doing in that sector, including directional bias and top tokens by confidence.
        </p>
      </Section>

      {/* Alpha Hunting */}
      <Section id="hunting" icon={<Crosshair size={18} />} title="Alpha Hunting">
        <p>
          The Alpha Hunting page lets you discover and filter profitable wallets on Hyperliquid.
          Think of it as a leaderboard with deep analytics.
        </p>

        <div className="grid gap-3">
          <Term name="Sharpe Ratio (30d)">
            A measure of risk-adjusted returns. A Sharpe above 2.0 is excellent — the trader is
            generating strong returns relative to the risk they take. Below 1.0 means the returns
            may not justify the volatility.
          </Term>

          <Term name="Win Rate">
            Percentage of trades that were profitable. A 60%+ win rate is strong, but context
            matters — a trader with 40% win rate but huge winners and tiny losers can still be
            very profitable.
          </Term>

          <Term name="Alpha Decay Score">
            Measures how consistent a trader&apos;s edge is over time. A low decay score means their
            strategy keeps working. A high decay score suggests their alpha may be fading —
            past performance might not predict future results.
          </Term>

          <Term name="Total PnL">
            Cumulative profit and loss in USD. Combines realized PnL from closed trades and
            unrealized PnL from open positions. The primary measure of a trader&apos;s success.
          </Term>
        </div>
      </Section>

      {/* Position Heatmap */}
      <Section id="heatmap" icon={<Target size={18} />} title="Position Heatmap">
        <p>
          The heatmap on each wallet profile page visualizes all open positions as a treemap.
          Bigger blocks = larger position size. Color intensity indicates profitability.
        </p>

        <div className="grid gap-3">
          <Term name="Block Size">
            Proportional to the notional value of the position. Larger positions take up more
            visual space, making it easy to see where the trader has the most capital at risk.
          </Term>

          <Term name="Color Gradient">
            Green gradients indicate profitable positions (positive unrealized PnL). Red gradients
            indicate losing positions. Deeper color intensity means higher ROE% (Return on Equity).
          </Term>

          <Term name="Side Indicator">
            The thin colored bar at the bottom of each block shows the position direction —
            green for long, red for short.
          </Term>

          <Term name="ROE% (Return on Equity)">
            The percentage return relative to the margin used. A 5x leveraged position that moves
            2% in your favour shows 10% ROE. High ROE with low leverage is the ideal setup.
          </Term>
        </div>
      </Section>

      {/* Copy Trade */}
      <Section id="copy-trade" icon={<Copy size={18} />} title="Copy Trading">
        <p>
          Copy trading lets you mirror the trades of wallets you&apos;ve identified through Alpha Hunting
          or Smart Money analysis. Connect your wallet to set up copy configurations.
        </p>

        <div className="grid gap-3">
          <Term name="Copy Ratio (%)">
            The percentage of the target trader&apos;s position size you want to mirror. At 50%, if
            the target opens a $10,000 position, you&apos;ll open a $5,000 position. Adjust based on
            your risk tolerance and account size.
          </Term>

          <Term name="Max Position (USD)">
            The maximum dollar amount for any single copied position. This is your safety cap —
            even if the target trader opens a massive position, yours won&apos;t exceed this limit.
          </Term>
        </div>

        <div className="bg-[#111111] rounded-xl p-4 border border-[#ff3b3b20]">
          <p className="text-[#ff3b3b] font-medium text-xs mb-1.5">Risk Warning</p>
          <p className="text-[#999999] text-xs">
            Copy trading involves significant risk. Past performance does not guarantee future results.
            Always set conservative max positions and never copy trade with funds you cannot afford to lose.
            Slippage and timing differences mean your results will differ from the target trader.
          </p>
        </div>
      </Section>

      {/* Pocket Quant */}
      <Section id="quant" icon={<Zap size={18} />} title="Pocket Quant (Strategy Builder)">
        <p>
          Build rule-based trading strategies without code. Define conditions (entry rules, exit rules,
          position sizing) and backtest them against historical Hyperliquid data.
        </p>

        <div className="grid gap-3">
          <Term name="Entry Rules">
            Conditions that must be met to open a position. Examples: &quot;RSI crosses below 30&quot;,
            &quot;Price breaks above 20-day high&quot;, &quot;Whale wallets are 80%+ long&quot;.
          </Term>

          <Term name="Exit Rules">
            Conditions that trigger closing a position. Includes take-profit, stop-loss, trailing
            stop, and time-based exits. Good exit rules are as important as good entries.
          </Term>

          <Term name="Backtesting">
            Testing your strategy against historical data to see how it would have performed.
            Key metrics: total return, max drawdown, Sharpe ratio, and number of trades.
          </Term>
        </div>
      </Section>

      {/* Key Metrics Glossary */}
      <Section id="glossary" icon={<Activity size={18} />} title="Key Metrics Glossary">
        <div className="grid gap-3">
          <Term name="PnL (Profit and Loss)">
            The net gain or loss from trading. Realized PnL comes from closed trades. Unrealized
            PnL is the paper gain/loss on open positions. Total PnL = Realized + Unrealized.
          </Term>

          <Term name="Leverage">
            A multiplier on your position size. At 10x leverage, $1,000 of margin controls
            a $10,000 position. Higher leverage amplifies both gains and losses. Liquidation
            risk increases with leverage.
          </Term>

          <Term name="Notional Value">
            The total dollar value of a position. A 10 ETH position at $3,000/ETH has a notional
            value of $30,000, regardless of the margin used.
          </Term>

          <Term name="Funding Rate">
            A periodic payment between long and short holders on perpetual contracts. When funding
            is positive, longs pay shorts. When negative, shorts pay longs. Farmers exploit this
            by being on the receiving side.
          </Term>

          <Term name="Delta">
            Net directional exposure. A trader with $100K long and $80K short has $20K net long
            delta. Delta-neutral means near-zero net exposure — the trader profits from funding
            or volatility rather than direction.
          </Term>

          <Term name="Liquidation">
            When a position&apos;s losses approach the margin deposited, the exchange forcefully closes
            it. Higher leverage = closer liquidation price = higher risk. Monitoring leverage
            across tracked wallets helps assess their risk profile.
          </Term>

          <Term name="Max Drawdown">
            The largest peak-to-trough decline in account value. A trader who went from $100K
            to $60K before recovering had a 40% max drawdown. Lower is better — it measures
            worst-case downside risk.
          </Term>

          <Term name="Volume">
            Total dollar value of trades executed. High volume with low PnL may indicate
            market making or high-frequency strategies. High volume with high PnL indicates
            a skilled active trader.
          </Term>
        </div>
      </Section>

      {/* Platform Tips */}
      <Section id="tips" icon={<Shield size={18} />} title="Tips & Best Practices">
        <div className="space-y-3 text-xs text-[#999999]">
          <div className="flex gap-3 items-start">
            <span className="text-[#00ff88] font-bold text-sm mt-0.5">1</span>
            <p><strong className="text-white">Don&apos;t blindly follow whales.</strong> Large wallets can absorb losses you can&apos;t. Always consider position sizing relative to your own account.</p>
          </div>
          <div className="flex gap-3 items-start">
            <span className="text-[#00ff88] font-bold text-sm mt-0.5">2</span>
            <p><strong className="text-white">Look for confluence.</strong> A token with high confidence, multiple whale positions, AND strong momentum is a much better signal than any one factor alone.</p>
          </div>
          <div className="flex gap-3 items-start">
            <span className="text-[#00ff88] font-bold text-sm mt-0.5">3</span>
            <p><strong className="text-white">Watch for farmer signals.</strong> If many delta-neutral farmers are active on a coin, it usually means funding rates are elevated — this can indicate overcrowded positioning.</p>
          </div>
          <div className="flex gap-3 items-start">
            <span className="text-[#00ff88] font-bold text-sm mt-0.5">4</span>
            <p><strong className="text-white">Check alpha decay.</strong> A trader with a high Sharpe but high alpha decay may have had one lucky streak. Prefer consistent performers with low decay scores.</p>
          </div>
          <div className="flex gap-3 items-start">
            <span className="text-[#00ff88] font-bold text-sm mt-0.5">5</span>
            <p><strong className="text-white">Use copy trade conservatively.</strong> Start with low copy ratios (10-25%) and tight max position limits. Increase only after observing the target&apos;s performance over time.</p>
          </div>
          <div className="flex gap-3 items-start">
            <span className="text-[#00ff88] font-bold text-sm mt-0.5">6</span>
            <p><strong className="text-white">Sector narratives matter.</strong> If smart money is rotating into AI tokens across many wallets, that&apos;s a thematic signal worth paying attention to beyond individual tokens.</p>
          </div>
        </div>
      </Section>

      <div className="text-center py-6 text-[#444444] text-xs">
        AlphaLens — Hyperliquid Trader Intelligence
      </div>
    </div>
  )
}
