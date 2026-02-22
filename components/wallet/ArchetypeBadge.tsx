const ARCHETYPES: Record<string, { label: string; color: string; bg: string }> = {
  scalper: { label: 'Scalper', color: '#34EAB9', bg: '#072724' },
  swing_trader: { label: 'Swing', color: '#8AADA9', bg: '#072724' },
  momentum_trader: { label: 'Momentum', color: '#34EAB9', bg: '#072724' },
  high_conviction: { label: 'High Conv.', color: '#F0FAF8', bg: '#0C302C' },
  funding_arb: { label: 'Funding Arb', color: '#8AADA9', bg: '#072724' },
  farmer: { label: 'Farmer', color: '#34EAB9', bg: '#072724' },
  market_maker: { label: 'Market Maker', color: '#8AADA9', bg: '#0C302C' },
  unknown: { label: 'Unknown', color: '#4A706C', bg: '#072724' },
}

export function ArchetypeBadge({ type }: { type: string }) {
  const config = ARCHETYPES[type] || ARCHETYPES.unknown
  return (
    <span
      className="text-[11px] font-medium px-2 py-0.5 rounded"
      style={{ color: config.color, backgroundColor: config.bg }}
    >
      {config.label}
    </span>
  )
}
