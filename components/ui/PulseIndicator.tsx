export function PulseIndicator({ active = true }: { active?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-[#34EAB9] pulse-accent' : 'bg-[#4A706C]'}`} />
      <span className="text-[11px] text-[#4A706C]">{active ? 'Live' : 'Offline'}</span>
    </div>
  )
}
