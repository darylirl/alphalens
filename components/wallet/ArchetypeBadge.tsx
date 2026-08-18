// Canonical archetype vocabulary (lib/wallets/classify.ts)
const ARCHETYPES: Record<string, { label: string; color: string; bg: string }> = {
  market_maker: { label: 'Market Maker', color: 'rgba(255,255,255,0.55)', bg: '#0F1A1E' },
  momentum_trader: { label: 'Momentum', color: '#34EAB9', bg: '#0F1A1E' },
  basis_trader: { label: 'Basis', color: 'rgba(255,255,255,0.55)', bg: '#0F1A1E' },
  whale: { label: 'Whale', color: '#F0FAF8', bg: '#0F1A1E' },
  scalper: { label: 'Scalper', color: '#34EAB9', bg: '#0F1A1E' },
  swing_trader: { label: 'Swing', color: 'rgba(255,255,255,0.55)', bg: '#0F1A1E' },
  unclassified: { label: 'Unclassified', color: 'rgba(255,255,255,0.40)', bg: '#0F1A1E' },
}

export function ArchetypeBadge({ type }: { type: string }) {
  const config = ARCHETYPES[type] || ARCHETYPES.unclassified
  return (
    <span
      className="text-[11px] font-medium px-2 py-0.5 rounded"
      style={{ color: config.color, backgroundColor: config.bg }}
    >
      {config.label}
    </span>
  )
}
