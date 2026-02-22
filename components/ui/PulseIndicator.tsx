export function PulseIndicator({ active = true }: { active?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full ${active ? 'bg-[#00ff88] pulse-green' : 'bg-[#888888]'}`} />
      <span className="text-xs text-[#888888]">{active ? 'Live' : 'Offline'}</span>
    </div>
  )
}
