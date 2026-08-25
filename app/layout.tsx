import type { Metadata, Viewport } from 'next'
import './globals.css'
import { WalletProvider } from '@/lib/wallet/WalletContext'
import { AppShell } from '@/components/layout/AppShell'

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://alphalens-taupe.vercel.app'),
  title: 'AlphaLens',
  description: 'Hyperliquid Trader Intelligence Platform',
  icons: {
    icon: '/favicon.png',
    apple: '/favicon.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#0F1A1E',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#0F1A1E] text-[#F0FAF8] antialiased">
        <WalletProvider>
          <AppShell>{children}</AppShell>
        </WalletProvider>
      </body>
    </html>
  )
}
