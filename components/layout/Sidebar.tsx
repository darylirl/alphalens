'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { Home, Crosshair, Star, Zap, Bell, Search, DollarSign, Copy, Wallet, HelpCircle, Settings } from 'lucide-react'
import { useWallet } from '@/lib/wallet/WalletContext'

const navItems = [
  { href: '/dashboard', icon: Home, label: 'Dashboard' },
  { href: '/hunters', icon: Crosshair, label: 'Wallet Explorer' },
  { href: '/smart-money', icon: DollarSign, label: 'Smart Money' },
  { href: '/copy-trade', icon: Copy, label: 'Copy Trade' },
  { href: '/watchlist', icon: Star, label: 'Watchlist' },
  { href: '/quant', icon: Zap, label: 'My Strategies' },
  { href: '/alerts', icon: Bell, label: 'Alerts' },
  { href: '/learn', icon: HelpCircle, label: 'Learn' },
]

export function Sidebar({ className = '' }: { className?: string }) {
  const path = usePathname()
  const router = useRouter()
  const { address, connect, disconnect, connecting } = useWallet()
  const [query, setQuery] = useState('')

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    const addr = q.startsWith('0x') ? q : `0x${q}`
    if (addr.length >= 10 && /^0x[a-fA-F0-9]+$/.test(addr)) {
      router.push(`/wallet/${addr}`)
      setQuery('')
    }
  }

  return (
    <aside className={`w-64 bg-[#0F1A1E] border-r border-white/[0.08] flex-col ${className}`}>
      <div className="px-5 pt-5 pb-4">
        <Link href="/" className="block">
          <h1 className="text-lg font-bold tracking-tight">
            <span className="text-[#34EAB9]">Alpha</span><span className="text-[#F0FAF8]"> Lens</span>
          </h1>
        </Link>
      </div>

      <div className="px-3 mb-4">
        <form onSubmit={handleSearch}>
          <div className="flex items-center gap-2 bg-[#0F1A1E] border border-white/[0.08] rounded px-3 py-2 focus-within:border-[#34EAB9] transition-colors">
            <Search size={14} className="text-white/40" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search wallet 0x..."
              className="bg-transparent text-sm outline-none flex-1 placeholder:text-white/40 text-[#F0FAF8]"
            />
          </div>
        </form>
      </div>

      <nav className="flex-1 px-2 space-y-0.5">
        {navItems.map(({ href, icon: Icon, label }) => {
          const active = path.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 text-sm transition-all duration-150 relative ${
                active
                  ? 'text-[#34EAB9] bg-white/[0.06]'
                  : 'text-white/55 hover:text-[#F0FAF8] hover:bg-white/[0.06]'
              }`}
            >
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 bg-[#34EAB9] rounded-r" />
              )}
              <Icon size={16} strokeWidth={active ? 2 : 1.5} />
              {label}
            </Link>
          )
        })}
      </nav>

      <div className="mt-auto px-3 pb-4 pt-3 border-t border-white/[0.08] space-y-3">
        {address ? (
          <button
            onClick={disconnect}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-sm bg-[#0F1A1E] text-[#34EAB9] hover:bg-white/[0.06] transition-colors rounded"
          >
            <Wallet size={14} />
            <span className="font-mono text-xs">{address.slice(0, 6)}...{address.slice(-4)}</span>
          </button>
        ) : (
          <button
            onClick={connect}
            disabled={connecting}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-sm bg-[#34EAB9] text-[#0F1A1E] font-semibold hover:brightness-110 transition-all rounded disabled:opacity-50"
          >
            <Wallet size={14} />
            {connecting ? 'Connecting...' : 'Connect Wallet'}
          </button>
        )}
        <div className="flex items-center gap-2 px-3 py-1">
          <div className="w-1.5 h-1.5 rounded-full bg-[#34EAB9] pulse-accent" />
          <span className="text-[11px] text-white/40">Live data connected</span>
        </div>
      </div>
    </aside>
  )
}
