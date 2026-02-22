'use client'
import { Search } from 'lucide-react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function TopBar({ title }: { title: string }) {
  const [query, setQuery] = useState('')
  const router = useRouter()

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (query.startsWith('0x') && query.length >= 10) {
      router.push(`/wallet/${query}`)
      setQuery('')
    }
  }

  return (
    <header className="sticky top-0 z-40 bg-[#0a0a0a]/80 backdrop-blur-xl border-b border-[#222222]">
      <div className="flex items-center justify-between px-4 py-3 lg:px-6">
        <h1 className="text-lg font-bold lg:hidden">
          <span className="text-[#00ff88]">A</span>L
        </h1>
        <h2 className="hidden lg:block text-lg font-semibold">{title}</h2>

        <form onSubmit={handleSearch} className="flex-1 max-w-xs ml-4 lg:max-w-sm">
          <div className="flex items-center gap-2 bg-[#161616] border border-[#222222] rounded-xl px-3 py-2">
            <Search size={14} className="text-[#888888]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search wallet 0x..."
              className="bg-transparent text-sm outline-none flex-1 placeholder:text-[#888888]"
            />
          </div>
        </form>
      </div>
    </header>
  )
}
