'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Crosshair, Star, Zap, Bell, Search } from 'lucide-react'

const navItems = [
  { href: '/dashboard', icon: Home, label: 'Dashboard' },
  { href: '/hunters', icon: Crosshair, label: 'Alpha Hunters' },
  { href: '/watchlist', icon: Star, label: 'Watchlist' },
  { href: '/quant', icon: Zap, label: 'Quant Builder' },
  { href: '/alerts', icon: Bell, label: 'Alerts' },
]

export function Sidebar({ className = '' }: { className?: string }) {
  const path = usePathname()
  return (
    <aside className={`w-64 bg-[#111111] border-r border-[#222222] flex-col p-4 ${className}`}>
      <div className="mb-8">
        <h1 className="text-xl font-bold">
          <span className="text-[#00ff88]">Alpha</span> Lens
        </h1>
        <p className="text-[#888888] text-xs mt-1">Hyperliquid Trader Intelligence</p>
      </div>

      <div className="mb-6">
        <div className="flex items-center gap-2 bg-[#161616] border border-[#222222] rounded-xl px-3 py-2.5">
          <Search size={16} className="text-[#888888]" />
          <input
            placeholder="Search wallet..."
            className="bg-transparent text-sm outline-none flex-1 placeholder:text-[#888888]"
          />
        </div>
      </div>

      <nav className="space-y-1">
        {navItems.map(({ href, icon: Icon, label }) => {
          const active = path.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${
                active
                  ? 'text-[#00ff88] bg-[#00ff8810]'
                  : 'text-[#888888] hover:text-white hover:bg-[#161616]'
              }`}
            >
              <Icon size={18} strokeWidth={active ? 2 : 1.5} />
              {label}
            </Link>
          )
        })}
      </nav>

      <div className="mt-auto pt-4 border-t border-[#222222]">
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="w-2 h-2 rounded-full bg-[#00ff88] pulse-green" />
          <span className="text-xs text-[#888888]">Live data connected</span>
        </div>
      </div>
    </aside>
  )
}
