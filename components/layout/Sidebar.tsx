'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { Home, Crosshair, Star, Zap, Bell, Search, DollarSign, Copy, Wallet, HelpCircle } from 'lucide-react'
import { useWallet } from '@/lib/wallet/WalletContext'

const navItems = [
  { href: '/dashboard', icon: Home, label: 'Dashboard' },
  { href: '/hunters', icon: Crosshair, label: 'Alpha Hunting' },
  { href: '/smart-money', icon: DollarSign, label: 'Smart Money' },
  { href: '/copy-trade', icon: Copy, label: 'Copy Trade' },
  { href: '/watchlist', icon: Star, label: 'Watchlist' },
  { href: '/quant', icon: Zap, label: 'Pocket Quant' },
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
    if (query.startsWith('0x') && query.length >= 10) {
      router.push(`/wallet/${query}`)
      setQuery('')
    }
  }

  return (
    <aside className={`w-64 bg-[#111111] border-r border-[#222222] flex-col p-4 ${className}`}>
      <div className="mb-8">
        <h1 className="text-xl font-bold">
          <span className="text-[#00ff88]">Alpha</span> Lens
        </h1>
        <p className="text-[#888888] text-xs mt-1">Hyperliquid Trader Intelligence</p>
      </div>

      <form onSubmit={handleSearch} className="mb-6">
        <div className="flex items-center gap-2 bg-[#161616] border border-[#222222] rounded-xl px-3 py-2.5">
          <Search size={16} className="text-[#888888]" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search wallet 0x..."
            className="bg-transparent text-sm outline-none flex-1 placeholder:text-[#888888]"
          />
        </div>
      </form>

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

      <div className="mt-auto pt-4 border-t border-[#222222] space-y-3">
        {address ? (
          <button
            onClick={disconnect}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm bg-[#00ff8810] text-[#00ff88] hover:bg-[#00ff8820] transition-colors"
          >
            <Wallet size={16} />
            <span className="font-mono text-xs">{address.slice(0, 6)}...{address.slice(-4)}</span>
          </button>
        ) : (
          <button
            onClick={connect}
            disabled={connecting}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm bg-[#00ff88] text-black font-semibold hover:bg-[#00dd77] transition-colors disabled:opacity-50"
          >
            <Wallet size={16} />
            {connecting ? 'Connecting...' : 'Connect Wallet'}
          </button>
        )}
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="w-2 h-2 rounded-full bg-[#00ff88] pulse-green" />
          <span className="text-xs text-[#888888]">Live data connected</span>
        </div>
      </div>
    </aside>
  )
}
