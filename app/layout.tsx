import type { Metadata, Viewport } from 'next'
import './globals.css'
import { WalletProvider } from '@/lib/wallet/WalletContext'
import { AppShell } from '@/components/layout/AppShell'

export const metadata: Metadata = {
  title: 'Alpha Lens',
  description: 'Hyperliquid Trader Intelligence Platform',
}

export const viewport: Viewport = {
  themeColor: '#010E0C',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#010E0C] text-[#F0FAF8] antialiased">
        <WalletProvider>
          <AppShell>{children}</AppShell>
        </WalletProvider>
      </body>
    </html>
  )
}
