'use client'
import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Search } from 'lucide-react'

const navLinks = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/hunters', label: 'Explorer' },
  { href: '/smart-money', label: 'Smart Money' },
  { href: '/wallets', label: 'Wallets' },
  { href: '/agent', label: 'AI Agent' },
  { href: '/copy-trade', label: 'Copy Trade' },
  { href: '/watchlist', label: 'Watchlist' },
  { href: '/quant', label: 'Strategies' },
  { href: '/signals', label: 'Signals' },
  { href: '/performance', label: 'Performance' },
  { href: '/alerts', label: 'Alerts' },
  { href: '/learn', label: 'Learn' },
]

export function Navbar() {
  const path = usePathname()
  const router = useRouter()
  const isLanding = path === '/'
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchError, setSearchError] = useState(false)

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    const q = searchQuery.trim()
    if (/^0x[a-fA-F0-9]{40}$/.test(q)) {
      setSearchError(false)
      setSearchQuery('')
      router.push(`/wallet/${q}`)
    } else {
      setSearchError(true)
      setTimeout(() => setSearchError(false), 2000)
    }
  }, [searchQuery, router])

  useEffect(() => {
    setDrawerOpen(false)
  }, [path])

  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [drawerOpen])

  const toggleDrawer = useCallback(() => setDrawerOpen(prev => !prev), [])
  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  return (
    <>
      {/* Fixed top navbar */}
      <nav
        className="fixed top-0 left-0 right-0 z-50"
        style={{
          background: '#072724',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <div className="flex items-center justify-between h-14 md:h-16">
          {/* Left: logo + nav links together */}
          <div className="hidden md:flex items-center gap-8" style={{ paddingLeft: '24px' }}>
            <Link href="/" className="flex items-center shrink-0">
              <Image src="/logo.png" alt="Alpha Lens" width={220} height={44} className="h-11 w-auto" />
            </Link>
            {!isLanding && navLinks.map(({ href, label }) => {
              const active = path.startsWith(href)
              return (
                <Link
                  key={href}
                  href={href}
                  className="text-sm transition-colors duration-150 ease-out whitespace-nowrap"
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    fontWeight: 400,
                    color: active ? '#34EAB9' : '#8AADA9',
                  }}
                  onMouseEnter={e => { if (!active) (e.target as HTMLElement).style.color = '#F0FAF8' }}
                  onMouseLeave={e => { if (!active) (e.target as HTMLElement).style.color = '#8AADA9' }}
                >
                  {label}
                </Link>
              )
            })}
          </div>

          {/* Mobile left side */}
          <div className="flex md:hidden items-center" style={{ paddingLeft: '16px' }}>
            <Link href="/">
              <Image src="/favicon.png" alt="AlphaLens" width={36} height={36} className="h-9 w-9" />
            </Link>
            {!isLanding && (
              <button
                onClick={toggleDrawer}
                className="p-4 flex flex-col justify-center items-center"
                aria-label="Toggle menu"
              >
                <span
                  className="block w-[18px] h-[2px] bg-[#F0FAF8] transition-transform duration-200 ease-out"
                  style={{ transform: drawerOpen ? 'translateY(3px) rotate(45deg)' : 'none' }}
                />
                <span
                  className="block w-[18px] h-[2px] bg-[#F0FAF8] mt-1 transition-opacity duration-200"
                  style={{ opacity: drawerOpen ? 0 : 1 }}
                />
                <span
                  className="block w-[18px] h-[2px] bg-[#F0FAF8] mt-1 transition-transform duration-200 ease-out"
                  style={{ transform: drawerOpen ? 'translateY(-3px) rotate(-45deg)' : 'none' }}
                />
              </button>
            )}
          </div>

          {/* Right: search + CTA */}
          <div className="flex items-center gap-3" style={{ paddingRight: '24px' }}>
            {/* Global address search — desktop only, app pages */}
            {!isLanding && (
              <form onSubmit={handleSearch} className="hidden md:flex items-center relative">
                <Search size={13} className="absolute left-2.5 text-white/30 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search address (0x...)"
                  className={`w-44 lg:w-56 bg-white/[0.04] border rounded-lg pl-8 pr-3 py-1.5 text-xs font-mono text-[#F0FAF8] placeholder:text-white/25 focus:outline-none transition-colors ${
                    searchError
                      ? 'border-[#FF3B5C]/50 bg-[#FF3B5C]/5'
                      : 'border-white/[0.08] focus:border-[#34EAB9]/40'
                  }`}
                />
              </form>
            )}
            {isLanding && (
              <Link
                href="/dashboard"
                className="hidden md:inline-block text-sm font-medium transition-all duration-150 ease-out"
                style={{
                  fontFamily: 'Inter, sans-serif',
                  border: '1px solid #34EAB9',
                  background: 'transparent',
                  color: '#34EAB9',
                  padding: '12px 20px',
                  borderRadius: '4px',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = '#34EAB9'
                  e.currentTarget.style.color = '#010E0C'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = '#34EAB9'
                }}
              >
                Launch App
              </Link>
            )}
            {isLanding && (
              <Link
                href="/dashboard"
                className="md:hidden text-sm font-medium transition-all duration-150 ease-out"
                style={{
                  fontFamily: 'Inter, sans-serif',
                  border: '1px solid #34EAB9',
                  background: 'transparent',
                  color: '#34EAB9',
                  padding: '10px 16px',
                  borderRadius: '4px',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = '#34EAB9'
                  e.currentTarget.style.color = '#010E0C'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = '#34EAB9'
                }}
              >
                Launch App
              </Link>
            )}
          </div>
        </div>
      </nav>

      {/* Mobile drawer — only on app pages */}
      {!isLanding && (
        <div
          className="fixed inset-0 z-[60] md:hidden pointer-events-none"
          style={{
            background: drawerOpen ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0)',
            transition: 'background 250ms ease-out',
            pointerEvents: drawerOpen ? 'auto' : 'none',
          }}
          onClick={closeDrawer}
        >
          <div
            className="absolute top-0 left-0 h-full flex flex-col"
            style={{
              width: '280px',
              background: '#072724',
              transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)',
              transition: drawerOpen ? 'transform 250ms ease-out' : 'transform 200ms ease-in',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Drawer header */}
            <div
              className="flex items-center justify-between p-6"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
            >
              <Link href="/" className="flex items-center" onClick={closeDrawer}>
                <Image src="/logo.png" alt="Alpha Lens" width={220} height={44} className="h-11 w-auto" />
              </Link>
              <button
                onClick={closeDrawer}
                className="text-[#8AADA9] hover:text-[#F0FAF8] transition-colors text-xl leading-none p-1"
                aria-label="Close menu"
              >
                &#x2715;
              </button>
            </div>

            {/* Drawer nav links */}
            <nav className="flex-1 overflow-y-auto">
              {navLinks.map(({ href, label }, i) => {
                const active = path.startsWith(href)
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={closeDrawer}
                    className="block"
                    style={{
                      padding: '20px 24px',
                      fontFamily: 'Inter, sans-serif',
                      fontSize: '16px',
                      fontWeight: 400,
                      color: active ? '#34EAB9' : '#F0FAF8',
                      borderLeft: active ? '3px solid #34EAB9' : '3px solid transparent',
                      borderBottom: i < navLinks.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                    }}
                  >
                    {label}
                  </Link>
                )
              })}
            </nav>

            {/* Drawer CTA */}
            <div className="p-6">
              <Link
                href="/dashboard"
                onClick={closeDrawer}
                className="block text-center text-sm font-medium"
                style={{
                  fontFamily: 'Inter, sans-serif',
                  background: '#34EAB9',
                  color: '#010E0C',
                  padding: '12px 20px',
                  borderRadius: '4px',
                  width: '100%',
                }}
              >
                Launch App
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
