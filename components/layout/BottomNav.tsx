'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Crosshair, DollarSign, Zap, Settings } from 'lucide-react'

const tabs = [
  { href: '/dashboard', icon: Home, label: 'Dashboard' },
  { href: '/hunters', icon: Crosshair, label: 'Explorer' },
  { href: '/smart-money', icon: DollarSign, label: 'Smart $' },
  { href: '/quant', icon: Zap, label: 'Strategies' },
  { href: '/learn', icon: Settings, label: 'Settings' },
]

export function BottomNav({ className = '' }: { className?: string }) {
  const path = usePathname()
  return (
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
      </div>
    </nav>
  )
}
