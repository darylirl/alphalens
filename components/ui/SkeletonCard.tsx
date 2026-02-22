export function SkeletonCard() {
  return (
    <div className="card p-4 animate-pulse">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-6 h-4 bg-[#222222] rounded" />
          <div>
            <div className="w-24 h-4 bg-[#222222] rounded mb-1" />
            <div className="w-16 h-3 bg-[#222222] rounded" />
          </div>
        </div>
        <div className="w-16 h-6 bg-[#222222] rounded-full" />
      </div>
      <div className="grid grid-cols-3 gap-3 mb-3">
        {[1, 2, 3].map(i => (
          <div key={i}>
            <div className="w-12 h-3 bg-[#222222] rounded mb-1" />
            <div className="w-16 h-4 bg-[#222222] rounded" />
          </div>
        ))}
      </div>
      <div className="w-full h-1 bg-[#222222] rounded-full" />
    </div>
  )
}
