'use client'
import { useState, useMemo } from 'react'
import type { UserFunding } from '@/lib/hyperliquid/types'

interface FundingHistoryProps {
  fundings: UserFunding[]
}

const PAGE_SIZE = 25

export function FundingHistory({ fundings }: FundingHistoryProps) {
  const [page, setPage] = useState(0)

  // Sort newest first
  const sorted = useMemo(() => {
    return [...fundings].sort((a, b) => b.time - a.time)
  }, [fundings])

  // Summary stats
  const totalFunding = useMemo(() => {
    return fundings.reduce((sum, f) => sum + parseFloat(f.delta?.usdc || '0'), 0)
  }, [fundings])

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE)
  const pageData = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  if (fundings.length === 0) {
    return <p className="text-white/40 text-sm text-center py-8">No funding history available.</p>
  }

  return (
    <div>
      {/* Summary */}
      <div className="flex items-center gap-4 mb-3">
        <div className="text-xs text-white/40">
          Total funding: <span className={`font-mono font-medium ${totalFunding >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
            {totalFunding >= 0 ? '+' : ''}${totalFunding.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
        <span className="text-white/30 text-xs ml-auto">{sorted.length} payments</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-white/40 border-b border-white/[0.06]">
              <th className="text-left py-2 pr-3 font-normal">Time</th>
              <th className="text-left py-2 pr-3 font-normal">Asset</th>
              <th className="text-right py-2 pr-3 font-normal">Position Size</th>
              <th className="text-right py-2 pr-3 font-normal">Funding Rate</th>
              <th className="text-right py-2 font-normal">Payment (USDC)</th>
            </tr>
          </thead>
          <tbody>
            {pageData.map((f, i) => {
              const payment = parseFloat(f.delta?.usdc || '0')
              const rate = parseFloat(f.delta?.fundingRate || '0')
              const size = parseFloat(f.delta?.szi || '0')
              const coin = f.delta?.coin || ''
              const time = new Date(f.time)
              return (
                <tr
                  key={`${f.time}-${coin}-${i}`}
                  className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors"
                >
                  <td className="py-2 pr-3 text-white/50 font-mono whitespace-nowrap">
                    {time.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{' '}
                    {time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
                  </td>
                  <td className="py-2 pr-3 font-medium text-[#F0FAF8]">{coin}</td>
                  <td className="py-2 pr-3 text-right font-mono text-white/70">
                    <span className={size > 0 ? 'text-[#34EAB9]' : size < 0 ? 'text-[#FF3B5C]' : ''}>
                      {size > 0 ? 'L ' : size < 0 ? 'S ' : ''}{Math.abs(size).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-white/50">
                    {(rate * 100).toFixed(4)}%
                  </td>
                  <td className={`py-2 text-right font-mono ${
                    payment > 0 ? 'text-[#34EAB9]' : payment < 0 ? 'text-[#FF3B5C]' : 'text-white/40'
                  }`}>
                    {payment >= 0 ? '+' : ''}${payment.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
