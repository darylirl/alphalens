'use client'
import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { AssetPosition } from '@/lib/hyperliquid/types'

interface HeatmapCell {
  coin: string
  size: number
  szi: number
  pnl: number
  leverage: number
  pctOfTotal: number
  entryPx: number
  roe: number
}

function getPnlGradient(pnl: number, roe: number): string {
  if (pnl > 0) {
    const intensity = Math.min(Math.abs(roe) / 50, 1)
    return `linear-gradient(135deg, rgba(0,${Math.round(140 + intensity * 115)},${Math.round(60 + intensity * 40)},0.9), rgba(0,${Math.round(100 + intensity * 80)},${Math.round(40 + intensity * 20)},0.7))`
  }
  if (pnl < 0) {
    const intensity = Math.min(Math.abs(roe) / 50, 1)
    return `linear-gradient(135deg, rgba(${Math.round(140 + intensity * 115)},${Math.round(20 + intensity * 10)},${Math.round(20 + intensity * 10)},0.9), rgba(${Math.round(100 + intensity * 80)},${Math.round(15)},${Math.round(15)},0.7))`
  }
  return 'linear-gradient(135deg, rgba(34,34,34,0.9), rgba(28,28,28,0.7))'
}

function formatPnl(n: number): string {
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

function formatNotional(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

export function PositionHeatmap({ positions }: { positions: AssetPosition[] }) {
  const [hoveredCoin, setHoveredCoin] = useState<string | null>(null)

  const cells = useMemo(() => {
    const active = positions
      .filter(p => parseFloat(p.position.szi) !== 0)
      .map(p => {
        const pos = p.position
        const szi = parseFloat(pos.szi)
        const posValue = Math.abs(parseFloat(pos.positionValue || '0'))
        const pnl = parseFloat(pos.unrealizedPnl || '0')
        const leverage = pos.leverage?.value || 0
        const entryPx = parseFloat(pos.entryPx || '0')
        const marginUsed = parseFloat(pos.marginUsed || '0')
        const roe = marginUsed > 0 ? (pnl / marginUsed) * 100 : 0
        return { coin: pos.coin, size: posValue, szi, pnl, leverage, pctOfTotal: 0, entryPx, roe }
      })
      .sort((a, b) => b.size - a.size)

    const total = active.reduce((sum, c) => sum + c.size, 0)
    for (const c of active) c.pctOfTotal = total > 0 ? (c.size / total) * 100 : 0
    return active
  }, [positions])

  if (!cells.length) {
    return <p className="text-[#8AADA9] text-sm text-center py-4">No open positions to display</p>
  }

  const rects = computeTreemapLayout(cells, 0, 0, 100, 100)
  const hoveredCell = hoveredCoin ? cells.find(c => c.coin === hoveredCoin) : null

  return (
    <div className="space-y-3">
      {/* Heatmap grid */}
      <div className="relative w-full rounded overflow-hidden" style={{ paddingBottom: '55%' }}>
        <div className="absolute inset-0">
          {rects.map((r, i) => {
            const cell = cells[i]
            const isLong = cell.szi > 0
            const isHovered = hoveredCoin === cell.coin
            const gradient = getPnlGradient(cell.pnl, cell.roe)
            const showFull = r.w > 18 && r.h > 16
            const showMedium = r.w > 10 && r.h > 10
            const showMini = r.w > 5 && r.h > 5

            return (
              <motion.div
                key={cell.coin}
                onMouseEnter={() => setHoveredCoin(cell.coin)}
                onMouseLeave={() => setHoveredCoin(null)}
                className="absolute cursor-pointer transition-all duration-150"
                style={{
                  left: `${r.x}%`,
                  top: `${r.y}%`,
                  width: `${r.w}%`,
                  height: `${r.h}%`,
                  padding: '1.5px',
                }}
                animate={{
                  scale: isHovered ? 1.02 : 1,
                  zIndex: isHovered ? 10 : 1,
                }}
              >
                <div
                  className="w-full h-full rounded-md flex flex-col items-center justify-center overflow-hidden relative"
                  style={{
                    background: gradient,
                    boxShadow: isHovered
                      ? cell.pnl >= 0
                        ? '0 0 20px rgba(0,255,136,0.3), inset 0 0 15px rgba(0,255,136,0.1)'
                        : '0 0 20px rgba(255,59,59,0.3), inset 0 0 15px rgba(255,59,59,0.1)'
                      : 'inset 0 1px 0 rgba(255,255,255,0.05)',
                    border: isHovered
                      ? cell.pnl >= 0 ? '1px solid rgba(0,255,136,0.4)' : '1px solid rgba(255,59,59,0.4)'
                      : '1px solid rgba(255,255,255,0.05)',
                  }}
                >
                  {/* Full label */}
                  {showFull && (
                    <div className="flex flex-col items-center gap-0.5 px-1">
                      <span className="font-bold text-[#F0FAF8] drop-shadow-md" style={{ fontSize: r.w > 28 ? '13px' : '10px' }}>
                        {cell.coin}
                      </span>
                      <span
                        className="font-bold drop-shadow-md"
                        style={{
                          fontSize: r.w > 28 ? '11px' : '9px',
                          color: cell.pnl >= 0 ? '#34EAB9' : '#FF3B5C',
                        }}
                      >
                        {cell.pnl >= 0 ? '+' : ''}{formatPnl(cell.pnl)}
                      </span>
                      <span className="font-mono text-[#F0FAF8]/60 drop-shadow-sm" style={{ fontSize: r.w > 28 ? '9px' : '7px' }}>
                        {isLong ? 'LONG' : 'SHORT'} {cell.leverage}x
                      </span>
                      <span className="font-mono text-[#F0FAF8]/40" style={{ fontSize: '7px' }}>
                        {cell.pctOfTotal.toFixed(0)}% of portfolio
                      </span>
                    </div>
                  )}
                  {/* Medium label */}
                  {!showFull && showMedium && (
                    <div className="flex flex-col items-center px-0.5">
                      <span className="font-bold text-[#F0FAF8] drop-shadow-md text-[9px]">{cell.coin}</span>
                      <span
                        className="font-semibold drop-shadow-md text-[7px]"
                        style={{ color: cell.pnl >= 0 ? '#34EAB9' : '#FF3B5C' }}
                      >
                        {cell.pnl >= 0 ? '+' : ''}{formatPnl(cell.pnl)}
                      </span>
                    </div>
                  )}
                  {/* Mini label */}
                  {!showFull && !showMedium && showMini && (
                    <span className="font-bold text-[#F0FAF8]/80 drop-shadow-md text-[7px]">{cell.coin}</span>
                  )}

                  {/* Side indicator bar */}
                  <div
                    className="absolute bottom-0 left-0 right-0 h-[2px]"
                    style={{ background: isLong ? '#34EAB9' : '#FF3B5C', opacity: 0.6 }}
                  />
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>

      {/* Hover tooltip */}
      <AnimatePresence>
        {hoveredCell && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="card p-3 grid grid-cols-6 gap-2 text-xs"
          >
            <div>
              <p className="text-[10px] text-[#4A706C]">Coin</p>
              <p className="font-bold">{hoveredCell.coin}</p>
            </div>
            <div>
              <p className="text-[10px] text-[#4A706C]">Side</p>
              <p className={`font-semibold ${hoveredCell.szi > 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                {hoveredCell.szi > 0 ? 'Long' : 'Short'} <span className="font-mono">{hoveredCell.leverage}x</span>
              </p>
            </div>
            <div>
              <p className="text-[10px] text-[#4A706C]">Size</p>
              <p className="font-mono font-semibold">{formatNotional(hoveredCell.size)}</p>
            </div>
            <div>
              <p className="text-[10px] text-[#4A706C]">Entry</p>
              <p className="font-mono">${hoveredCell.entryPx.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-[10px] text-[#4A706C]">uPnL</p>
              <p className={`font-mono font-bold ${hoveredCell.pnl >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                {hoveredCell.pnl >= 0 ? '+' : ''}{formatPnl(hoveredCell.pnl)}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-[#4A706C]">ROE</p>
              <p className={`font-mono font-bold ${hoveredCell.roe >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                {hoveredCell.roe >= 0 ? '+' : ''}{hoveredCell.roe.toFixed(1)}%
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Legend */}
      <div className="flex items-center justify-between text-[10px] text-[#4A706C] px-1">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: 'linear-gradient(135deg, rgba(0,255,136,0.9), rgba(0,180,100,0.7))' }} /> Profit
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: 'linear-gradient(135deg, rgba(255,59,59,0.9), rgba(180,15,15,0.7))' }} /> Loss
          </span>
        </div>
        <span>Size = notional value &middot; Intensity = ROE%</span>
      </div>
    </div>
  )
}

// Squarified treemap layout
interface Rect { x: number; y: number; w: number; h: number }

function computeTreemapLayout(cells: HeatmapCell[], x: number, y: number, w: number, h: number): Rect[] {
  if (cells.length === 0) return []
  if (cells.length === 1) return [{ x, y, w, h }]

  const total = cells.reduce((sum, c) => sum + c.size, 0)
  if (total === 0) return cells.map(() => ({ x, y, w: 0, h: 0 }))

  let bestSplit = 1
  let bestRatio = Infinity
  let runningSum = 0

  for (let i = 0; i < cells.length - 1; i++) {
    runningSum += cells[i].size
    const aspectDiff = Math.abs(runningSum / total - 0.5)
    if (aspectDiff < bestRatio) {
      bestRatio = aspectDiff
      bestSplit = i + 1
    }
  }

  const group1 = cells.slice(0, bestSplit)
  const group2 = cells.slice(bestSplit)
  const fraction = group1.reduce((s, c) => s + c.size, 0) / total
  const rects: Rect[] = []

  if (w >= h) {
    const w1 = w * fraction
    rects.push(...computeTreemapLayout(group1, x, y, w1, h))
    rects.push(...computeTreemapLayout(group2, x + w1, y, w - w1, h))
  } else {
    const h1 = h * fraction
    rects.push(...computeTreemapLayout(group1, x, y, w, h1))
    rects.push(...computeTreemapLayout(group2, x, y + h1, w, h - h1))
  }

  return rects
}
