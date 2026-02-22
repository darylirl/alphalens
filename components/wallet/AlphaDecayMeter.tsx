export function AlphaDecayMeter({ score }: { score: number }) {
  const pct = Math.min(score * 100, 100)
  const color = score < 0.1 ? '#34EAB9' : score < 0.3 ? 'rgba(255,255,255,0.55)' : '#FF3B5C'
  const label = score < 0.1 ? 'Low Decay' : score < 0.3 ? 'Moderate' : 'High Decay'

  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-white/40 text-[11px]">Alpha Decay</span>
        <span className="text-[11px] font-medium" style={{ color }}>{label}</span>
      </div>
      <div className="h-1 bg-[#0F1A1E] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}
