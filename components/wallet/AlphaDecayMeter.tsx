export function AlphaDecayMeter({ score }: { score: number }) {
  const pct = Math.min(score * 100, 100)
  const color = score < 0.1 ? '#00ff88' : score < 0.3 ? '#ffd60a' : '#ff3b3b'
  const label = score < 0.1 ? 'Low Decay' : score < 0.3 ? 'Moderate' : 'High Decay'

  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-[#888888] text-xs">Alpha Decay</span>
        <span className="text-xs font-medium" style={{ color }}>{label}</span>
      </div>
      <div className="h-1 bg-[#222222] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}
