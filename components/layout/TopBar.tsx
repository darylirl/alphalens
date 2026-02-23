'use client'
import Image from 'next/image'
import { Search, Bell } from 'lucide-react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useWallet } from '@/lib/wallet/WalletContext'

export function TopBar({ title }: { title: string }) {
  const [query, setQuery] = useState('')
  const router = useRouter()
  const { address, connect, connecting } = useWallet()

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
    <header className="sticky top-0 z-40 bg-[#0F1A1E]/80 backdrop-blur-xl border-b border-white/[0.08]">
      <div className="flex items-center justify-between px-4 py-3 lg:px-6">
        <Image src="/favicon.png" alt="AlphaLens" width={28} height={28} className="h-7 w-7 lg:hidden" />
        <h2 className="hidden lg:block text-base font-semibold text-[#F0FAF8]">{title}</h2>

        <form onSubmit={handleSearch} className="flex-1 max-w-xs ml-4 lg:max-w-sm">
          <div className="flex items-center gap-2 bg-[#0F1A1E] border border-white/[0.08] rounded px-3 py-2 focus-within:border-[#34EAB9] transition-colors">
            <Search size={14} className="text-white/40" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search wallet 0x..."
              className="bg-transparent text-sm outline-none flex-1 placeholder:text-white/40 text-[#F0FAF8]"
            />
          </div>
        </form>

        <div className="flex items-center gap-3 ml-3">
          <button className="relative text-white/40 hover:text-white/55 transition-colors lg:hidden">
            <Bell size={18} />
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-[#34EAB9] pulse-accent" />
          </button>
          {!address && (
            <button
              onClick={connect}
              disabled={connecting}
              className="hidden sm:flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded border border-[#34EAB9] text-[#34EAB9] hover:bg-[#34EAB9] hover:text-[#0F1A1E] transition-all lg:hidden"
            >
              {connecting ? 'Connecting...' : 'Connect'}
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
