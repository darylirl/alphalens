'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { WalletProfile } from '@/components/wallet/WalletProfile'
import { SkeletonCard } from '@/components/ui/SkeletonCard'
import type { WalletDetail, PortfolioEntry } from '@/lib/hyperliquid/types'
import { Star } from 'lucide-react'

const PORTFOLIO_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

function getCachedPortfolio(address: string): PortfolioEntry[] | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(`alphalens_portfolio_${address.toLowerCase()}`)
    if (!raw) return null
    const cached = JSON.parse(raw) as { portfolio: PortfolioEntry[]; cachedAt: number }
    if (Date.now() - cached.cachedAt > PORTFOLIO_CACHE_TTL) return null
    return cached.portfolio
  } catch {
    return null
  }
}

function setCachedPortfolio(address: string, portfolio: PortfolioEntry[]): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(
      `alphalens_portfolio_${address.toLowerCase()}`,
      JSON.stringify({ portfolio, cachedAt: Date.now() })
    )
  } catch { /* full */ }
}

function getPortfolioTimeframe(portfolio: PortfolioEntry[], label: string): PortfolioEntry[1] | null {
  const entry = portfolio.find(([key]) => key === label)
  return entry ? entry[1] : null
}

function getAllTimePnl(portfolio: PortfolioEntry[]): number {
  const allTime = getPortfolioTimeframe(portfolio, 'allTime')
  if (!allTime?.pnlHistory?.length) return 0
  const lastPoint = allTime.pnlHistory[allTime.pnlHistory.length - 1]
  return parseFloat(lastPoint[1]) || 0
}

export default function WalletPage() {
  const params = useParams()
  const address = params.address as string
  const [detail, setDetail] = useState<WalletDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadWallet = async () => {
    setLoading(true)
    setError(null)

    // Try cached portfolio first
    const cachedPortfolio = getCachedPortfolio(address)

    try {
      const res = await fetch(`/api/wallets/${address}`, { cache: 'no-store' })
      const data = await res.json()
      if (res.ok && data.state) {
        const walletData = data as WalletDetail
        const portfolio = walletData.portfolio?.length ? walletData.portfolio : (cachedPortfolio || [])

        // Cache fresh portfolio
        if (walletData.portfolio?.length) {
          setCachedPortfolio(address, walletData.portfolio)
        }

        setDetail({ ...walletData, portfolio })
      } else {
        setError(data.error || 'Could not load wallet data')
      }
    } catch {
      setError('Network error - please try again')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (address) loadWallet()
  }, [address]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div>
        <div className="px-4 py-4 lg:px-6 space-y-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div>
        <div className="px-4 py-12 text-center">
          <p className="text-white/55 mb-2">{error || 'Wallet not found or API error'}</p>
          <p className="text-white/40 text-xs font-mono mb-4">{address}</p>
          <button onClick={loadWallet} className="text-sm bg-[#34EAB9] text-[#0F1A1E] font-semibold px-4 py-2 rounded">
            Retry
          </button>
        </div>
      </div>
    )
  }

  const headlinePnl = getAllTimePnl(detail.portfolio)

  return (
    <div>
      <div className="px-4 py-4 lg:px-6">
        <div className="flex justify-end mb-3">
          <button className="flex items-center gap-1.5 text-xs text-white/55 hover:text-[#34EAB9] transition-colors">
            <Star size={14} />
            Add to Watchlist
          </button>
        </div>
        <WalletProfile
          detail={detail}
          headlinePnl={headlinePnl}
        />
      </div>
    </div>
  )
}
