interface MetricPillProps {
  label: string
  value: string
  positive?: boolean
}

export function MetricPill({ label, value, positive }: MetricPillProps) {
  const colorClass = positive === undefined ? 'text-[#F0FAF8]' : positive ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'
  return (
    <div className="inline-flex items-center gap-2 bg-[#0C302C] border border-[#0D2E2A] rounded-full px-3 py-1.5">
      <span className="text-[#8AADA9] text-xs">{label}</span>
      <span className={`text-xs font-semibold ${colorClass}`}>{value}</span>
    </div>
  )
}
