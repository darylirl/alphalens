const ARCHETYPES: Record<string, { label: string; color: string; bg: string }> = {
  scalper: { label: 'Scalper', color: '#ff9500', bg: '#ff950020' },
  swing_trader: { label: 'Swing', color: '#007aff', bg: '#007aff20' },
  momentum_trader: { label: 'Momentum', color: '#bf5af2', bg: '#bf5af220' },
  high_conviction: { label: 'High Conv.', color: '#00ff88', bg: '#00ff8820' },
  funding_arb: { label: 'Funding Arb', color: '#ffd60a', bg: '#ffd60a20' },
  farmer: { label: 'Farmer', color: '#30d158', bg: '#30d15820' },
  market_maker: { label: 'Market Maker', color: '#5ac8fa', bg: '#5ac8fa20' },
  unknown: { label: 'Unknown', color: '#888888', bg: '#88888820' },
}

export function ArchetypeBadge({ type }: { type: string }) {
  const config = ARCHETYPES[type] || ARCHETYPES.unknown
  return (
    <span
      className="text-xs font-medium px-2.5 py-1 rounded-full"
      style={{ color: config.color, backgroundColor: config.bg }}
    >
      {config.label}
    </span>
  )
}
