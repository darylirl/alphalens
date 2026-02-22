'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Crosshair, Star, Zap, Bell } from 'lucide-react'

const tabs = [
  { href: '/dashboard', icon: Home, label: 'Home' },
  { href: '/hunters', icon: Crosshair, label: 'Hunt' },
  { href: '/watchlist', icon: Star, label: 'Watch' },
  { href: '/quant', icon: Zap, label: 'Quant' },
  { href: '/alerts', icon: Bell, label: 'Alerts' },
]

export function BottomNav({ className = '' }: { className?: string }) {
  const path = usePathname()
  return (
    <nav className={`fixed bottom-0 left-0 right-0 bg-[#111111] border-t border-[#222222] z-50 ${className}`}>
      <div className="flex">
        {tabs.map(({ href, icon: Icon, label }) => {
          const active = path.startsWith(href)
          return (
            <Link key={href} href={href} className={`flex-1 flex flex-col items-center py-3 gap-1 transition-colors ${active ? 'text-[#00ff88]' : 'text-[#888888]'}`}>
              <Icon size={20} strokeWidth={active ? 2 : 1.5} />
              <span className="text-[10px] font-medium">{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
