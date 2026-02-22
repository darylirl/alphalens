import type { Metadata, Viewport } from 'next'
import './globals.css'
import { BottomNav } from '@/components/layout/BottomNav'
import { Sidebar } from '@/components/layout/Sidebar'
import { WalletProvider } from '@/lib/wallet/WalletContext'

export const metadata: Metadata = {
  title: 'Alpha Lens',
  description: 'Track the best traders on Hyperliquid',
}

export const viewport: Viewport = {
  themeColor: '#0a0a0a',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans bg-[#0a0a0a] text-white antialiased">
        <WalletProvider>
          <div className="flex h-screen overflow-hidden">
            <Sidebar className="hidden lg:flex" />
            <main className="flex-1 overflow-y-auto pb-20 lg:pb-0">
              {children}
            </main>
          </div>
          <BottomNav className="lg:hidden" />
        </WalletProvider>
      </body>
    </html>
  )
}
