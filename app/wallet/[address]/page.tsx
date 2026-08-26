'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { WalletProfile } from '@/components/wallet/WalletProfile'
import { SkeletonCard } from '@/components/ui/SkeletonCard'
import type { WalletDetail, PortfolioEntry } from '@/lib/hyperliquid/types'
import Link from 'next/link'
import { Star, RefreshCw, Award, Clapperboard } from 'lucide-react'
import { useWalletStream } from '@/lib/hooks/useWalletStream'
import { PulseIndicator } from '@/components/ui/PulseIndicator'

const ARCHETYPE_STYLES: Record<string, string> = {
  market_maker: 'bg-violet-500/10 text-violet-400',
  momentum_trader: 'bg-blue-500/10 text-blue-400',
  basis_trader: 'bg-amber-500/10 text-amber-400',
  whale: 'bg-cyan-500/10 text-cyan-400',
  scalper: 'bg-pink-500/10 text-pink-400',
  swing_trader: 'bg-emerald-500/10 text-emerald-400',
  unclassified: 'bg-white/[0.04] text-white/30',
}

const ARCHETYPE_LABELS: Record<string, string> = {
  market_maker: 'Market Maker',
  momentum_trader: 'Momentum',
  basis_trader: 'Basis Trader',
  whale: 'Whale',
  scalper: 'Scalper',
  swing_trader: 'Swing Trader',
  unclassified: 'Unclassified',
}

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
  const [walletTags, setWalletTags] = useState<string[]>([])
  const [classifying, setClassifying] = useState(false)

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
        if (data.tags) setWalletTags(data.tags)
      } else {
        setError(data.error || 'Could not load wallet data')
      }
    } catch {
      setError('Network error - please try again')
    } finally {
      setLoading(false)
    }
  }

  const reclassify = async () => {
    setClassifying(true)
    try {
      const res = await fetch(`/api/wallets/classify?address=${address}`, { method: 'POST' })
      const data = await res.json()
      if (data.success && data.data?.results?.[0]?.tags) {
        setWalletTags(data.data.results[0].tags)
      }
    } catch { /* ignore */ }
    finally { setClassifying(false) }
  }

  const { status: streamStatus, liveFills, livePositions } = useWalletStream(address)

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

  // Merge live data into detail without replacing historical data
  const mergedDetail = { ...detail }
  if (liveFills.length > 0) {
    const existingIds = new Set(detail.fills.map(f => f.tid))
    const newFills = liveFills.filter(f => !existingIds.has(f.tid))
    mergedDetail.fills = [...newFills, ...detail.fills].slice(0, 500)
  }
  if (livePositions) {
    const updated = [...detail.state.assetPositions]
    for (const incoming of livePositions) {
      const idx = updated.findIndex(p => p.position.coin === incoming.position.coin)
      if (idx >= 0) {
        updated[idx] = incoming
      } else if (parseFloat(incoming.position.szi) !== 0) {
        updated.push(incoming)
      }
    }
    mergedDetail.state = { ...detail.state, assetPositions: updated.filter(p => parseFloat(p.position.szi) !== 0) }
  }

  return (
    <div>
      <div className="px-4 py-4 lg:px-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <PulseIndicator active={streamStatus === 'connected'} />
            {walletTags.filter(t => t !== 'unclassified').map(t => (
              <span key={t} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${ARCHETYPE_STYLES[t] || ARCHETYPE_STYLES.unclassified}`}>
                {ARCHETYPE_LABELS[t] || t}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={`/card/${address}`}
              className="flex items-center gap-1 text-[10px] text-white/40 hover:text-[#34EAB9] transition-colors"
            >
              <Award size={10} />
              Report card
            </Link>
            <Link
              href={`/replay/${address}`}
              className="flex items-center gap-1 text-[10px] text-white/40 hover:text-[#34EAB9] transition-colors"
            >
              <Clapperboard size={10} />
              Replay
            </Link>
            <button
              onClick={reclassify}
              disabled={classifying}
              className="flex items-center gap-1 text-[10px] text-white/40 hover:text-[#34EAB9] transition-colors disabled:opacity-50"
            >
              <RefreshCw size={10} className={classifying ? 'animate-spin' : ''} />
              {classifying ? 'Classifying...' : 'Reclassify'}
            </button>
            <button className="flex items-center gap-1.5 text-xs text-white/55 hover:text-[#34EAB9] transition-colors">
              <Star size={14} />
              Add to Watchlist
            </button>
          </div>
        </div>
        <WalletProfile
          detail={mergedDetail}
          headlinePnl={headlinePnl}
          primaryTag={walletTags.find(t => t !== 'unclassified') || null}
        />
      </div>
    </div>
  )
}
