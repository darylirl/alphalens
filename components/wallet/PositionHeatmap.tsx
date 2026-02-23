'use client'
import { useMemo, useState, useCallback } from 'react'
import type { AssetPosition } from '@/lib/hyperliquid/types'

const BG = '#072724'
const COLOR_POS = '#34EAB9'
const COLOR_NEG = '#FF3B5C'
const COLOR_NEUTRAL = '#1A3A35'
const GAP = 2

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

function getBlockColor(pnl: number): string {
  if (pnl > 0) return COLOR_POS
  if (pnl < 0) return COLOR_NEG
  return COLOR_NEUTRAL
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

export function PositionHeatmap({ positions }: { positions: AssetPosition[] }) {
  const [hoveredCoin, setHoveredCoin] = useState<string | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })

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

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    setTooltipPos({ x: e.clientX, y: e.clientY })
  }, [])

  if (!cells.length) {
    return <p className="text-white/55 text-sm text-center py-4">No open positions to display</p>
  }

  const rects = computeTreemapLayout(cells, 0, 0, 100, 100)
  const hoveredCell = hoveredCoin ? cells.find(c => c.coin === hoveredCoin) : null

  return (
    <div style={{ background: BG }} className="relative">
      {/* Heatmap grid */}
      <div
        className="relative w-full"
        style={{ paddingBottom: '55%', background: BG }}
        onMouseMove={handleMouseMove}
      >
        <div className="absolute inset-0">
          {rects.map((r, i) => {
            const cell = cells[i]
            const isLong = cell.szi > 0
            const isHovered = hoveredCoin === cell.coin
            const color = getBlockColor(cell.pnl)
            const showFull = r.w > 18 && r.h > 16
            const showMedium = r.w > 10 && r.h > 10
            const showMini = r.w > 5 && r.h > 5

            return (
              <div
                key={cell.coin}
                onMouseEnter={() => setHoveredCoin(cell.coin)}
                onMouseLeave={() => setHoveredCoin(null)}
                className="absolute cursor-pointer"
                style={{
                  left: `${r.x}%`,
                  top: `${r.y}%`,
                  width: `${r.w}%`,
                  height: `${r.h}%`,
                  padding: `${GAP / 2}px`,
                }}
              >
                <div
                  className="w-full h-full flex flex-col items-center justify-center overflow-hidden relative"
                  style={{
                    background: color,
                    borderRadius: 0,
                    opacity: isHovered ? 0.85 : 1,
                    transition: 'opacity 100ms ease-out',
                  }}
                >
                  {/* Full label */}
                  {showFull && (
                    <div className="flex flex-col items-center gap-0.5 px-1">
                      <span className="font-bold text-white" style={{ fontSize: r.w > 28 ? '13px' : '10px' }}>
                        {cell.coin}
                      </span>
                      <span
                        className="font-mono font-semibold text-white"
                        style={{ fontSize: r.w > 28 ? '11px' : '9px' }}
                      >
                        {cell.pnl >= 0 ? '+' : ''}{formatPnl(cell.pnl)}
                      </span>
                      <span className="font-mono text-white/60" style={{ fontSize: r.w > 28 ? '9px' : '7px' }}>
                        {isLong ? 'LONG' : 'SHORT'} {cell.leverage}x
                      </span>
                      <span className="font-mono text-white/40" style={{ fontSize: '7px' }}>
                        {cell.pctOfTotal.toFixed(0)}%
                      </span>
                    </div>
                  )}
                  {/* Medium label */}
                  {!showFull && showMedium && (
                    <div className="flex flex-col items-center px-0.5">
                      <span className="font-bold text-white text-[9px]">{cell.coin}</span>
                      <span className="font-mono font-semibold text-white text-[7px]">
                        {cell.pnl >= 0 ? '+' : ''}{formatPnl(cell.pnl)}
                      </span>
                    </div>
                  )}
                  {/* Mini label */}
                  {!showFull && !showMedium && showMini && (
                    <span className="font-bold text-white/80 text-[7px]">{cell.coin}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Tooltip — fixed, follows cursor */}
      {hoveredCell && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: tooltipPos.x + 12,
            top: tooltipPos.y + 12,
            transition: 'opacity 100ms ease-out',
          }}
        >
          <div
            className="px-3 py-2"
            style={{
              background: BG,
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 0,
              minWidth: '200px',
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-white text-xs font-semibold">{hoveredCell.coin}</span>
              <span
                className="font-mono text-[11px] font-semibold"
                style={{ color: hoveredCell.szi > 0 ? COLOR_POS : COLOR_NEG }}
              >
                {hoveredCell.szi > 0 ? 'Long' : 'Short'} {hoveredCell.leverage}x
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px]">
              <div className="flex justify-between">
                <span className="text-white/40">Size</span>
                <span className="font-mono text-white">{formatNotional(hoveredCell.size)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Entry</span>
                <span className="font-mono text-white">${hoveredCell.entryPx.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">uPnL</span>
                <span
                  className="font-mono font-semibold"
                  style={{ color: hoveredCell.pnl >= 0 ? COLOR_POS : COLOR_NEG }}
                >
                  {hoveredCell.pnl >= 0 ? '+' : ''}{formatPnl(hoveredCell.pnl)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">ROE</span>
                <span
                  className="font-mono font-semibold"
                  style={{ color: hoveredCell.roe >= 0 ? COLOR_POS : COLOR_NEG }}
                >
                  {hoveredCell.roe >= 0 ? '+' : ''}{hoveredCell.roe.toFixed(1)}%
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center justify-between text-[10px] text-white/40 px-2 py-1.5" style={{ background: BG }}>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5" style={{ background: COLOR_POS, borderRadius: 0 }} /> Profit
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5" style={{ background: COLOR_NEG, borderRadius: 0 }} /> Loss
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5" style={{ background: COLOR_NEUTRAL, borderRadius: 0 }} /> Flat
          </span>
        </div>
        <span>Size = notional value</span>
      </div>
    </div>
  )
}
