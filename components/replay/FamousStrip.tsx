import Link from 'next/link'
import type { FamousReplay } from '@/lib/replay/famous'

// The "Famous replays" strip on the /replay index: curated, verified episodes
// a visitor can open without pasting an address. Every card's number is the
// manifest's verified realized PnL over the pinned window (exchange closedPnl
// figures, checked against real fills before the entry shipped) — the card
// shows nothing the replay itself cannot back.

const usd = (n: number) =>
  `${n < 0 ? '−' : '+'}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

export function FamousStrip({ entries }: { entries: FamousReplay[] }) {
  if (entries.length === 0) return null

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-sm font-bold">Famous replays</h2>
        <p className="text-[10px] text-white/35">
          curated episodes, verified against real fills
        </p>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 snap-x md:grid md:grid-cols-2 md:overflow-visible md:mx-0 md:px-0">
        {entries.map(e => (
          <Link
            key={e.slug}
            href={`/replay/famous/${e.slug}`}
            className="snap-start shrink-0 w-[260px] md:w-auto bg-white/[0.03] border border-white/[0.08] rounded-lg p-3 hover:border-[#F5A623]/40 transition-colors flex flex-col gap-1.5"
          >
            <p className="text-[9px] font-mono text-[#F5A623] uppercase tracking-wider">
              {e.source === 'autopsy' ? 'wallet from our copy-trading autopsy' : 'public episode'}
            </p>
            <p className="text-[13px] font-semibold leading-snug text-[#F0FAF8]">{e.title}</p>
            <p className="text-[11px] text-white/50 leading-relaxed line-clamp-2">{e.story}</p>
            <div className="mt-auto pt-1 flex items-center gap-2 font-mono text-[10px] text-white/45">
              <span>{shortAddr(e.address)}</span>
              <span className="text-[#F5A623]">{e.coin}</span>
              <span className={`ml-auto font-bold text-[11px] ${e.pnl_usd >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                {usd(e.pnl_usd)}
              </span>
            </div>
            <p className="text-[9px] text-white/30 font-mono">
              {e.window.from.slice(0, 10)} – {e.window.to.slice(0, 10)} · {e.bar_width} · verified
            </p>
          </Link>
        ))}
      </div>
    </div>
  )
}
