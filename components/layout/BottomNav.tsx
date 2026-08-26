'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { TrendingUp, BookOpenCheck, FlaskConical, Award, Clapperboard, MoreHorizontal } from 'lucide-react'

// Mirrors the desktop nav ranking: Pulse, then the differentiators (Ledger,
// Research), then the paste-an-address consumer surfaces (Card, Replay);
// everything else is one tap away under More.
const tabs = [
  { href: '/pulse', icon: TrendingUp, label: 'Pulse' },
  { href: '/ledger', icon: BookOpenCheck, label: 'Ledger' },
  { href: '/research', icon: FlaskConical, label: 'Research' },
  { href: '/card', icon: Award, label: 'Card' },
  { href: '/replay', icon: Clapperboard, label: 'Replay' },
]

// /copy-trade is intentionally absent: quarantined pending repositioning —
// our own backtests showed naive copy-trading loses money (see app/copy-trade).
const moreLinks = [
  { href: '/hunters', label: 'Explorer' },
  { href: '/wallets', label: 'Wallets' },
  { href: '/smart-money', label: 'Smart Money' },
  { href: '/performance', label: 'Performance' },
  { href: '/signals', label: 'Signals' },
  { href: '/alerts', label: 'Alerts' },
  { href: '/watchlist', label: 'Watchlist' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/agent', label: 'AI Agent' },
  { href: '/quant', label: 'Strategies' },
  { href: '/cohort', label: 'Cohort (Methodology)' },
  { href: '/learn', label: 'Learn' },
]

export function BottomNav({ className = '' }: { className?: string }) {
  const path = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)

  // Close the sheet on navigation
  useEffect(() => { setMoreOpen(false) }, [path])

  const moreActive = moreLinks.some(l => path.startsWith(l.href))

  return (
    <>
      {moreOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50"
          onClick={() => setMoreOpen(false)}
        >
          <div
            className="absolute bottom-[64px] left-0 right-0 bg-[#0F1A1E] border-t border-white/[0.08] rounded-t-xl max-h-[60vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            {moreLinks.map(({ href, label }) => {
              const active = path.startsWith(href)
              return (
                <Link
                  key={href}
                  href={href}
                  className={`block px-6 py-3.5 text-sm border-b border-white/[0.06] last:border-0 ${
                    active ? 'text-[#34EAB9]' : 'text-[#F0FAF8]'
                  }`}
                >
                  {label}
                </Link>
              )
            })}
          </div>
        </div>
      )}
      <nav className={`fixed bottom-0 left-0 right-0 bg-[#0F1A1E] border-t border-white/[0.08] z-50 ${className}`}>
        <div className="flex">
          {tabs.map(({ href, icon: Icon, label }) => {
            const active = path.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                className={`flex-1 flex flex-col items-center py-3 gap-1 transition-colors min-h-[44px] ${
                  active ? 'text-[#34EAB9]' : 'text-white/40'
                }`}
              >
                <Icon size={20} strokeWidth={active ? 2 : 1.5} />
                <span className="text-[10px] font-medium">{label}</span>
              </Link>
            )
          })}
          <button
            onClick={() => setMoreOpen(prev => !prev)}
            aria-expanded={moreOpen}
            aria-haspopup="menu"
            className={`flex-1 flex flex-col items-center py-3 gap-1 transition-colors min-h-[44px] ${
              moreOpen || moreActive ? 'text-[#34EAB9]' : 'text-white/40'
            }`}
          >
            <MoreHorizontal size={20} strokeWidth={moreOpen || moreActive ? 2 : 1.5} />
            <span className="text-[10px] font-medium">More</span>
          </button>
        </div>
      </nav>
    </>
  )
}
