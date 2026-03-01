'use client'
import { useState, useMemo } from 'react'
import type { Fill } from '@/lib/hyperliquid/types'
import { ChevronDown, ChevronUp } from 'lucide-react'

interface TradeHistoryProps {
  fills: Fill[]
}

const PAGE_SIZE = 25

export function TradeHistory({ fills }: TradeHistoryProps) {
  const [page, setPage] = useState(0)
  const [sortAsc, setSortAsc] = useState(false)
  const [filterAsset, setFilterAsset] = useState<string>('all')

  // Unique assets for filter
  const assets = useMemo(() => {
    const set = new Set(fills.map((f) => f.coin))
    return Array.from(set).sort()
  }, [fills])

  // Sorted and filtered
  const filtered = useMemo(() => {
    let data = [...fills]
    if (filterAsset !== 'all') data = data.filter((f) => f.coin === filterAsset)
    data.sort((a, b) => (sortAsc ? a.time - b.time : b.time - a.time))
    return data
  }, [fills, filterAsset, sortAsc])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const pageData = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  if (fills.length === 0) {
    return <p className="text-white/40 text-sm text-center py-8">No trade history available.</p>
  }

  return (
    <div>
      {/* Filters */}
      <div className="flex items-center gap-3 mb-3">
        <select
          value={filterAsset}
          onChange={(e) => { setFilterAsset(e.target.value); setPage(0) }}
          className="text-xs bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-white/70 focus:outline-none focus:border-[#34EAB9]/40"
        >
          <option value="all">All Assets ({fills.length})</option>
          {assets.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <button
          onClick={() => setSortAsc(!sortAsc)}
          className="flex items-center gap-1 text-xs text-white/40 hover:text-white/70 transition-colors"
        >
          {sortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {sortAsc ? 'Oldest first' : 'Newest first'}
        </button>
        <span className="text-white/30 text-xs ml-auto">{filtered.length} trades</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-white/40 border-b border-white/[0.06]">
              <th className="text-left py-2 pr-3 font-normal">Time</th>
              <th className="text-left py-2 pr-3 font-normal">Asset</th>
              <th className="text-left py-2 pr-3 font-normal">Side</th>
              <th className="text-right py-2 pr-3 font-normal">Size</th>
              <th className="text-right py-2 pr-3 font-normal">Price</th>
              <th className="text-right py-2 pr-3 font-normal">Realized PnL</th>
              <th className="text-right py-2 font-normal">Fee</th>
            </tr>
          </thead>
          <tbody>
            {pageData.map((fill, i) => {
              const pnl = parseFloat(fill.closedPnl || '0')
              const fee = parseFloat(fill.fee || '0')
              const isBuy = fill.side === 'B'
              const time = new Date(fill.time)
              return (
                <tr
                  key={`${fill.tid}-${i}`}
                  className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors"
                >
                  <td className="py-2 pr-3 text-white/50 font-mono whitespace-nowrap">
                    {time.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{' '}
                    {time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
                  </td>
                  <td className="py-2 pr-3 font-medium text-[#F0FAF8]">{fill.coin}</td>
                  <td className="py-2 pr-3">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      isBuy
                        ? 'bg-[#34EAB9]/10 text-[#34EAB9]'
                        : 'bg-[#FF3B5C]/10 text-[#FF3B5C]'
                    }`}>
                      {isBuy ? 'BUY' : 'SELL'}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-white/70">
                    {parseFloat(fill.sz).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-white/70">
                    ${parseFloat(fill.px).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                  </td>
                  <td className={`py-2 pr-3 text-right font-mono ${
                    pnl > 0 ? 'text-[#34EAB9]' : pnl < 0 ? 'text-[#FF3B5C]' : 'text-white/40'
                  }`}>
                    {pnl !== 0 ? `${pnl > 0 ? '+' : ''}$${pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                  </td>
                  <td className="py-2 text-right font-mono text-white/30">
                    ${fee.toFixed(2)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.06]">
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            className="text-xs text-white/40 hover:text-white/70 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ← Previous
          </button>
          <span className="text-xs text-white/30">
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
            className="text-xs text-white/40 hover:text-white/70 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
