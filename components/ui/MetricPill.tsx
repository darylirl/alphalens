interface MetricPillProps {
  label: string
  value: string
  positive?: boolean
}

export function MetricPill({ label, value, positive }: MetricPillProps) {
  const colorClass = positive === undefined ? 'text-[#F0FAF8]' : positive ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'
  return (
    <div className="inline-flex items-center gap-2 bg-[#0F1A1E] border border-white/[0.08] rounded-full px-3 py-1.5">
      <span className="text-white/55 text-xs">{label}</span>
      <span className={`text-xs font-semibold ${colorClass}`}>{value}</span>
    </div>
  )
}
