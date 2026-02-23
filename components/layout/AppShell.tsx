'use client'
import { Navbar } from './Navbar'

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Navbar />
      {/* pt-14 = 56px (mobile navbar), md:pt-16 = 64px (desktop navbar) */}
      <main className="min-h-screen pt-14 md:pt-16">
        {children}
      </main>
    </>
  )
}
