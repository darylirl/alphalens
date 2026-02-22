interface MetricPillProps {
  label: string
  value: string
  positive?: boolean
}

export function MetricPill({ label, value, positive }: MetricPillProps) {
  const colorClass = positive === undefined ? 'text-white' : positive ? 'text-[#00ff88]' : 'text-[#ff3b3b]'
  return (
    <div className="inline-flex items-center gap-2 bg-[#161616] border border-[#222222] rounded-full px-3 py-1.5">
      <span className="text-[#888888] text-xs">{label}</span>
      <span className={`text-xs font-semibold ${colorClass}`}>{value}</span>
    </div>
  )
}
