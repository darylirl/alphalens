// Archetype display vocabulary and per-archetype copyability context, shared
// by /cohort and /card. Every number in the context lines is from the two
// published backtest runs (backtest_results/ in the repo, written up in the
// copy-trading autopsy). Archetypes we did not replay say so instead of
// borrowing a number.

export const ARCHETYPE_LABELS: Record<string, string> = {
  market_maker: 'Market Maker',
  momentum_trader: 'Momentum',
  basis_trader: 'Basis Trader',
  whale: 'Whale',
  scalper: 'Scalper',
  swing_trader: 'Swing Trader',
  unclassified: 'Unclassified',
}

export const ARCHETYPE_STYLES: Record<string, string> = {
  market_maker: 'bg-violet-500/10 text-violet-400',
  momentum_trader: 'bg-blue-500/10 text-blue-400',
  basis_trader: 'bg-amber-500/10 text-amber-400',
  whale: 'bg-cyan-500/10 text-cyan-400',
  scalper: 'bg-pink-500/10 text-pink-400',
  swing_trader: 'bg-emerald-500/10 text-emerald-400',
  unclassified: 'bg-white/[0.04] text-white/40',
}

export const ARCHETYPE_CONTEXT: Record<string, { line: string; fromResearch: boolean }> = {
  scalper: {
    line:
      'The one copyable top-Sharpe wallet in our first replay was a scalper: 7,499 copied trades, 4.8% win rate, −$1,252 net in under three days. The 60s delay alone destroyed the edge.',
    fromResearch: true,
  },
  swing_trader: {
    line:
      'Swing wallets held over 4 hours in our tests (3.9 days on average) and still showed no copyable aggregate edge: 27,865 replayed trades, net −$9,362.',
    fromResearch: true,
  },
  momentum_trader: {
    line:
      'Momentum wallets fared no better in the same replay: 453 trades, net −$342, profit factor 0.69.',
    fromResearch: true,
  },
  market_maker: {
    line:
      'Two-sided inventory churn is market-neutral noise, not directional signal — excluded from capture scope since Aug 2026 for exactly that reason.',
    fromResearch: false,
  },
  basis_trader: {
    line:
      'Not covered by our replay tests — captured for aggregate flow context, with no copyability claim either way.',
    fromResearch: false,
  },
  whale: {
    line:
      'Not covered by our replay tests — captured for aggregate flow context, with no copyability claim either way.',
    fromResearch: false,
  },
  unclassified: {
    line:
      'In capture scope because an active signal or a verification job references the wallet, not because of behavioral classification.',
    fromResearch: false,
  },
}
