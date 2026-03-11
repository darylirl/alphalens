'use client'
import { memo, useEffect, useRef, type CSSProperties } from 'react'
import { useSmartMoneyFeed, type SmartMoneyTrade } from '@/lib/hooks/useSmartMoneyFeed'
import { PulseIndicator } from '@/components/ui/PulseIndicator'
import { CopyableAddress } from '@/components/ui/CopyableAddress'
import { List } from 'react-window'

const ROW_HEIGHT = 36
const VISIBLE_ROWS = 9
const LIST_HEIGHT = ROW_HEIGHT * VISIBLE_ROWS

const TAG_STYLES: Record<string, string> = {
  market_maker: 'bg-violet-500/10 text-violet-400',
  momentum_trader: 'bg-blue-500/10 text-blue-400',
  basis_trader: 'bg-amber-500/10 text-amber-400',
  whale: 'bg-cyan-500/10 text-cyan-400',
  scalper: 'bg-pink-500/10 text-pink-400',
  swing_trader: 'bg-emerald-500/10 text-emerald-400',
}

const TAG_LABELS: Record<string, string> = {
  market_maker: 'MM',
  momentum_trader: 'Mom',
  basis_trader: 'Basis',
  whale: 'Whale',
  scalper: 'Scalp',
  swing_trader: 'Swing',
}

// Module-level wallet cache (tags + labels)
let _walletTags: Map<string, string[]> = new Map()
let _walletLabels: Map<string, string> = new Map()
let _tagsFetched = false

/** Update a single wallet's label in the SmartMoneyFeed cache. */
export function updateWalletLabelCache(address: string, label: string | null) {
  const key = address.toLowerCase()
  if (label) {
    _walletLabels.set(key, label)
  } else {
    _walletLabels.delete(key)
  }
}

/** Update a single wallet's tags in the SmartMoneyFeed cache. */
export function updateWalletTagsCache(address: string, tags: string[]) {
  _walletTags.set(address.toLowerCase(), tags)
}

async function fetchWalletTags() {
  if (_tagsFetched) return
  _tagsFetched = true
  try {
    const res = await fetch('/api/wallets')
    if (!res.ok) return
    const data = await res.json()
    const wallets = Array.isArray(data) ? data : (data.wallets || data.data || [])
    for (const w of wallets) {
      if (w.address) {
        const key = w.address.toLowerCase()
        if (w.tags?.length) _walletTags.set(key, w.tags)
        if (w.label) _walletLabels.set(key, w.label)
      }
    }
  } catch { /* ignore */ }
}

const TradeRow = memo(function TradeRow({ trade }: { trade: SmartMoneyTrade }) {
  const isBuy = trade.side === 'B'
  const notional = parseFloat(trade.px) * parseFloat(trade.sz)
  const walletAddr = trade.wallets[0]?.toLowerCase()
  const tags = walletAddr ? _walletTags.get(walletAddr) : undefined
  const primaryTag = tags?.find(t => t !== 'unclassified')

  return (
    <div className="flex items-center justify-between py-1.5 px-2 rounded bg-white/[0.03] hover:bg-white/[0.06] transition-colors">
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
          isBuy ? 'bg-[#34EAB9]/15 text-[#34EAB9]' : 'bg-[#FF3B5C]/15 text-[#FF3B5C]'
        }`}>
          {isBuy ? 'BUY' : 'SELL'}
        </span>
        <span className="text-xs font-semibold text-[#F0FAF8]">{trade.coin}</span>
        <span className="text-[11px] font-mono text-white/50">
          ${notional >= 1000 ? `${(notional / 1000).toFixed(1)}K` : notional.toFixed(0)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {primaryTag && (
          <span className={`text-[8px] font-semibold px-1 py-0.5 rounded ${TAG_STYLES[primaryTag] || ''}`}>
            {TAG_LABELS[primaryTag] || primaryTag}
          </span>
        )}
        {trade.wallets.slice(0, 1).map((addr) => (
          <CopyableAddress key={addr} address={addr} mono className="text-[10px]" />
        ))}
        <span className="text-[10px] text-white/25 font-mono">
          {new Date(trade.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      </div>
    </div>
  )
})

// Module-level reference updated by SmartMoneyFeed on each render
let _tradesRef: SmartMoneyTrade[] = []

function VirtualRow({ index, style }: {
  index: number
  style: CSSProperties
  ariaAttributes: { 'aria-posinset': number; 'aria-setsize': number; role: 'listitem' }
}) {
  const trade = _tradesRef[index]
  if (!trade) return null
  return (
    <div style={{ ...style, paddingBottom: 4 }}>
      <TradeRow trade={trade} />
    </div>
  )
}

export function SmartMoneyFeed() {
  const { status, trades, trackedCount } = useSmartMoneyFeed()
  const fetched = useRef(false)

  useEffect(() => {
    if (!fetched.current) {
      fetched.current = true
      fetchWalletTags()
    }
  }, [])

  // Update module-level ref for the virtual row renderer
  _tradesRef = trades

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold">Smart Money Feed</h3>
          <p className="text-[11px] text-white/40">
            {trackedCount > 0 ? `Monitoring ${trackedCount} wallets` : 'Real-time tracked wallet activity'}
          </p>
        </div>
        <PulseIndicator active={status === 'connected'} />
      </div>

      {trades.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-white/40 text-xs">
            {status === 'connecting' ? 'Connecting to live feed...' :
             status === 'connected' ? 'Waiting for smart money trades...' :
             'Feed disconnected — reconnecting...'}
          </p>
        </div>
      ) : (
        <div style={{ height: LIST_HEIGHT }}>
          <List
            rowCount={trades.length}
            rowHeight={ROW_HEIGHT}
            overscanCount={3}
            rowComponent={VirtualRow}
            rowProps={{}}
            style={{ height: '100%' }}
          />
        </div>
      )}
    </div>
  )
}
