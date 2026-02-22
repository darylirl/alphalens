'use client'
import { useMemo } from 'react'
import type { AssetPosition } from '@/lib/hyperliquid/types'

interface HeatmapCell {
  coin: string
  size: number
  szi: number
  pnl: number
  leverage: number
  pctOfTotal: number
}

function getPnlColor(pnl: number): string {
  if (pnl > 0) {
    const intensity = Math.min(pnl / 1000, 1)
    const g = Math.round(100 + intensity * 155)
    return `rgb(0, ${g}, ${Math.round(intensity * 80)})`
  }
  if (pnl < 0) {
    const intensity = Math.min(Math.abs(pnl) / 1000, 1)
    const r = Math.round(100 + intensity * 155)
    return `rgb(${r}, ${Math.round(30 - intensity * 20)}, ${Math.round(30 - intensity * 20)})`
  }
  return '#222222'
}

function getPnlTextColor(pnl: number): string {
  if (pnl > 0) return '#00ff88'
  if (pnl < 0) return '#ff3b3b'
  return '#888888'
}

export function PositionHeatmap({ positions }: { positions: AssetPosition[] }) {
  const cells = useMemo(() => {
    const active = positions
      .filter(p => parseFloat(p.position.szi) !== 0)
      .map(p => {
        const pos = p.position
        const szi = parseFloat(pos.szi)
        const posValue = Math.abs(parseFloat(pos.positionValue || '0'))
        const pnl = parseFloat(pos.unrealizedPnl || '0')
        const leverage = pos.leverage?.value || 0
        return {
          coin: pos.coin,
          size: posValue,
          szi,
          pnl,
          leverage,
          pctOfTotal: 0,
        }
      })
      .sort((a, b) => b.size - a.size)

    const total = active.reduce((sum, c) => sum + c.size, 0)
    for (const c of active) {
      c.pctOfTotal = total > 0 ? (c.size / total) * 100 : 0
    }
    return active
  }, [positions])

  if (!cells.length) {
    return <p className="text-[#888888] text-sm text-center py-4">No open positions to display</p>
  }

  // Compute treemap layout (simple squarified algorithm)
  const rects = computeTreemapLayout(cells, 0, 0, 100, 100)

  return (
    <div className="relative w-full" style={{ paddingBottom: '60%' }}>
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 w-full h-full"
        preserveAspectRatio="none"
      >
        {rects.map((r, i) => {
          const cell = cells[i]
          const bgColor = getPnlColor(cell.pnl)
          const textColor = getPnlTextColor(cell.pnl)
          const isLong = cell.szi > 0
          const showLabels = r.w > 12 && r.h > 10

          return (
            <g key={cell.coin}>
              <rect
                x={r.x + 0.3}
                y={r.y + 0.3}
                width={Math.max(r.w - 0.6, 0)}
                height={Math.max(r.h - 0.6, 0)}
                fill={bgColor}
                rx={1}
                opacity={0.85}
                className="transition-opacity hover:opacity-100"
              />
              {showLabels && (
                <>
                  <text
                    x={r.x + r.w / 2}
                    y={r.y + r.h / 2 - 3}
                    textAnchor="middle"
                    fill="white"
                    fontSize={r.w > 25 ? 4.5 : 3.2}
                    fontWeight="bold"
                  >
                    {cell.coin}
                  </text>
                  <text
                    x={r.x + r.w / 2}
                    y={r.y + r.h / 2 + 1.5}
                    textAnchor="middle"
                    fill={textColor}
                    fontSize={r.w > 25 ? 3 : 2.5}
                  >
                    {cell.pnl >= 0 ? '+' : ''}${cell.pnl.toFixed(0)}
                  </text>
                  <text
                    x={r.x + r.w / 2}
                    y={r.y + r.h / 2 + 5.5}
                    textAnchor="middle"
                    fill="#aaaaaa"
                    fontSize={2.2}
                  >
                    {isLong ? 'LONG' : 'SHORT'} {cell.leverage}x
                  </text>
                </>
              )}
              {!showLabels && r.w > 5 && r.h > 5 && (
                <text
                  x={r.x + r.w / 2}
                  y={r.y + r.h / 2 + 1}
                  textAnchor="middle"
                  fill="white"
                  fontSize={2.5}
                  fontWeight="bold"
                >
                  {cell.coin}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {/* Legend */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-4 py-1.5 text-[10px] text-[#888888]">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#00ff88]" /> Profit
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#ff3b3b]" /> Loss
        </span>
        <span>Size = notional value</span>
      </div>
    </div>
  )
}

// Squarified treemap layout
interface Rect { x: number; y: number; w: number; h: number }

function computeTreemapLayout(
  cells: HeatmapCell[],
  x: number,
  y: number,
  w: number,
  h: number
): Rect[] {
  if (cells.length === 0) return []
  if (cells.length === 1) return [{ x, y, w, h }]

  const total = cells.reduce((sum, c) => sum + c.size, 0)
  if (total === 0) return cells.map(() => ({ x, y, w: 0, h: 0 }))

  // Split into two groups trying to balance area
  let bestSplit = 1
  let bestRatio = Infinity
  let runningSum = 0

  for (let i = 0; i < cells.length - 1; i++) {
    runningSum += cells[i].size
    const ratio1 = runningSum / total
    const aspectDiff = Math.abs(ratio1 - 0.5)
    if (aspectDiff < bestRatio) {
      bestRatio = aspectDiff
      bestSplit = i + 1
    }
  }

  const group1 = cells.slice(0, bestSplit)
  const group2 = cells.slice(bestSplit)
  const sum1 = group1.reduce((s, c) => s + c.size, 0)
  const fraction = sum1 / total

  const rects: Rect[] = []

  if (w >= h) {
    // Split horizontally
    const w1 = w * fraction
    rects.push(...computeTreemapLayout(group1, x, y, w1, h))
    rects.push(...computeTreemapLayout(group2, x + w1, y, w - w1, h))
  } else {
    // Split vertically
    const h1 = h * fraction
    rects.push(...computeTreemapLayout(group1, x, y, w, h1))
    rects.push(...computeTreemapLayout(group2, x, y + h1, w, h - h1))
  }

  return rects
}
