const ARCHETYPES: Record<string, { label: string; color: string; bg: string }> = {
  scalper: { label: 'Scalper', color: '#34EAB9', bg: '#0F1A1E' },
  swing_trader: { label: 'Swing', color: 'rgba(255,255,255,0.55)', bg: '#0F1A1E' },
  momentum_trader: { label: 'Momentum', color: '#34EAB9', bg: '#0F1A1E' },
  high_conviction: { label: 'High Conv.', color: '#F0FAF8', bg: '#0F1A1E' },
  funding_arb: { label: 'Funding Arb', color: 'rgba(255,255,255,0.55)', bg: '#0F1A1E' },
  farmer: { label: 'Farmer', color: '#34EAB9', bg: '#0F1A1E' },
  market_maker: { label: 'Market Maker', color: 'rgba(255,255,255,0.55)', bg: '#0F1A1E' },
  unknown: { label: 'Unknown', color: 'rgba(255,255,255,0.40)', bg: '#0F1A1E' },
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
