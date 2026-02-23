'use client'
import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const navLinks = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/hunters', label: 'Explorer' },
  { href: '/smart-money', label: 'Smart Money' },
  { href: '/copy-trade', label: 'Copy Trade' },
  { href: '/watchlist', label: 'Watchlist' },
  { href: '/quant', label: 'Strategies' },
  { href: '/alerts', label: 'Alerts' },
  { href: '/learn', label: 'Learn' },
]

export function Navbar() {
  const path = usePathname()
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Close drawer on route change
  useEffect(() => {
    setDrawerOpen(false)
  }, [path])

  // Lock body scroll when drawer is open
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
        {/* Desktop: h-16 (64px), Mobile: h-14 (56px) */}
        <div className="flex items-center justify-between h-14 md:h-16 px-4 md:px-6">
          {/* Left: Logo lockup */}
          {/* Desktop: favicon + wordmark */}
          <Link href="/" className="hidden md:flex items-center gap-[10px]">
            <Image src="/favicon.png" alt="" width={32} height={32} className="h-8 w-8" />
            <span className="text-[#F0FAF8] text-base font-medium" style={{ fontFamily: 'Inter, sans-serif' }}>
              Alpha Lens
            </span>
          </Link>

          {/* Mobile: favicon + hamburger */}
          <div className="flex md:hidden items-center gap-0">
            <Link href="/" className="pl-0">
              <Image src="/favicon.png" alt="AlphaLens" width={28} height={28} className="h-7 w-7" />
            </Link>
            <button
              onClick={toggleDrawer}
              className="p-4 flex flex-col justify-center items-center"
              aria-label="Toggle menu"
            >
              <span
                className="block w-[18px] h-[2px] bg-[#F0FAF8] transition-transform duration-200 ease-out"
                style={{
                  transform: drawerOpen ? 'translateY(3px) rotate(45deg)' : 'none',
                }}
              />
              <span
                className="block w-[18px] h-[2px] bg-[#F0FAF8] mt-1 transition-opacity duration-200"
                style={{
                  opacity: drawerOpen ? 0 : 1,
                }}
              />
              <span
                className="block w-[18px] h-[2px] bg-[#F0FAF8] mt-1 transition-transform duration-200 ease-out"
                style={{
                  transform: drawerOpen ? 'translateY(-3px) rotate(-45deg)' : 'none',
                }}
              />
            </button>
          </div>

          {/* Right: Desktop nav links + CTA */}
          <div className="hidden md:flex items-center gap-8">
            {navLinks.map(({ href, label }) => {
              const active = path.startsWith(href)
              return (
                <Link
                  key={href}
                  href={href}
                  className="text-sm transition-colors duration-150 ease-out"
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
            <Link
              href="/dashboard"
              className="text-sm font-medium transition-all duration-150 ease-out"
              style={{
                fontFamily: 'Inter, sans-serif',
                border: '1px solid #34EAB9',
                background: 'transparent',
                color: '#34EAB9',
                padding: '12px 20px',
                borderRadius: '4px',
              }}
              onMouseEnter={e => {
                const el = e.currentTarget
                el.style.background = '#34EAB9'
                el.style.color = '#010E0C'
              }}
              onMouseLeave={e => {
                const el = e.currentTarget
                el.style.background = 'transparent'
                el.style.color = '#34EAB9'
              }}
            >
              Launch App
            </Link>
          </div>
        </div>
      </nav>

      {/* Mobile drawer overlay */}
      <div
        className="fixed inset-0 z-[60] md:hidden pointer-events-none"
        style={{
          background: drawerOpen ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0)',
          transition: 'background 250ms ease-out',
          pointerEvents: drawerOpen ? 'auto' : 'none',
        }}
        onClick={closeDrawer}
      >
        {/* Drawer panel */}
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
          {/* Drawer header: logo + close */}
          <div
            className="flex items-center justify-between p-6"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
          >
            <Link href="/" className="flex items-center gap-[10px]" onClick={closeDrawer}>
              <Image src="/favicon.png" alt="" width={32} height={32} className="h-8 w-8" />
              <span className="text-[#F0FAF8] text-base font-medium" style={{ fontFamily: 'Inter, sans-serif' }}>
                Alpha Lens
              </span>
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
    </>
  )
}
