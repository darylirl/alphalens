'use client'
import { useMemo, useState, useCallback } from 'react'

interface HeatmapAsset {
  name: string
  change: number
  volume: number
  price: number
  oi: number
}

interface Props {
  assets: HeatmapAsset[]
  minThresholdPct?: number
}

const BG = '#072724'
const COLOR_POS = '#34EAB9'
const COLOR_NEG = '#FF3B5C'
const COLOR_NEUTRAL = '#1A3A35'
const GAP = 2

function getBlockColor(change: number): string {
  if (change > 0.5) return COLOR_POS
  if (change < -0.5) return COLOR_NEG
  return COLOR_NEUTRAL
}

function formatVolume(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

function formatPrice(n: number): string {
  if (n >= 1000) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  if (n >= 1) return `$${n.toFixed(2)}`
  if (n >= 0.01) return `$${n.toFixed(4)}`
  return `$${n.toPrecision(4)}`
}

// Squarified treemap layout — returns rects in px coords
interface Rect { x: number; y: number; w: number; h: number }

function layoutTreemap(sizes: number[], x: number, y: number, w: number, h: number): Rect[] {
  if (sizes.length === 0) return []
  if (sizes.length === 1) return [{ x, y, w, h }]

  const total = sizes.reduce((s, v) => s + v, 0)
  if (total === 0) return sizes.map(() => ({ x, y, w: 0, h: 0 }))

  // Find best split point (closest to 50/50)
  let bestSplit = 1
  let bestDiff = Infinity
  let running = 0

  for (let i = 0; i < sizes.length - 1; i++) {
    running += sizes[i]
    const diff = Math.abs(running / total - 0.5)
    if (diff < bestDiff) {
      bestDiff = diff
      bestSplit = i + 1
    }
  }

  const left = sizes.slice(0, bestSplit)
  const right = sizes.slice(bestSplit)
  const frac = left.reduce((s, v) => s + v, 0) / total
  const rects: Rect[] = []

  if (w >= h) {
    const w1 = w * frac
    rects.push(...layoutTreemap(left, x, y, w1, h))
    rects.push(...layoutTreemap(right, x + w1, y, w - w1, h))
  } else {
    const h1 = h * frac
    rects.push(...layoutTreemap(left, x, y, w, h1))
    rects.push(...layoutTreemap(right, x, y + h1, w, h - h1))
  }

  return rects
}

interface DisplayBlock {
  type: 'asset' | 'others'
  name: string
  change: number
  volume: number
  price: number
  oi: number
  assets?: HeatmapAsset[] // only for "others"
}

export function MarketHeatmap({ assets, minThresholdPct = 2.5 }: Props) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })

  const blocks = useMemo<DisplayBlock[]>(() => {
    if (!assets.length) return []

    const totalVol = assets.reduce((s, a) => s + a.volume, 0)
    if (totalVol === 0) return []

    const threshold = totalVol * (minThresholdPct / 100)
    const visible: DisplayBlock[] = []
    const small: HeatmapAsset[] = []

    for (const a of assets) {
      if (a.volume >= threshold) {
        visible.push({ type: 'asset', name: a.name, change: a.change, volume: a.volume, price: a.price, oi: a.oi })
      } else {
        small.push(a)
      }
    }

    if (small.length > 0) {
      const combinedVol = small.reduce((s, a) => s + a.volume, 0)
      const avgChange = small.reduce((s, a) => s + a.change * a.volume, 0) / (combinedVol || 1)
      visible.push({
        type: 'others',
        name: `Others (${small.length})`,
        change: Math.round(avgChange * 100) / 100,
        volume: combinedVol,
        price: 0,
        oi: small.reduce((s, a) => s + a.oi, 0),
        assets: small,
      })
    }

    // Sort by volume descending
    visible.sort((a, b) => b.volume - a.volume)
    return visible
  }, [assets, minThresholdPct])

  const rects = useMemo(() => {
    if (!blocks.length) return []
    return layoutTreemap(blocks.map(b => b.volume), 0, 0, 100, 100)
  }, [blocks])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    setTooltipPos({ x: e.clientX, y: e.clientY })
  }, [])

  if (!blocks.length) {
    return (
      <div className="w-full py-8 text-center text-white/40 text-sm" style={{ background: BG }}>
        No market data available
      </div>
    )
  }

  const hoveredBlock = hoveredIdx !== null ? blocks[hoveredIdx] : null

  return (
    <div style={{ background: BG }} className="relative">
      {/* Treemap grid */}
      <div
        className="relative w-full"
        style={{ paddingBottom: '55%', background: BG }}
        onMouseMove={handleMouseMove}
      >
        <div className="absolute inset-0">
          {rects.map((r, i) => {
            const block = blocks[i]
            const color = block.type === 'others' ? COLOR_NEUTRAL : getBlockColor(block.change)
            const isHovered = hoveredIdx === i
            // Size labels based on block dimensions — enforce minimum readable sizes
            const blockW = r.w
            const blockH = r.h
            const showTicker = blockW > 4 && blockH > 4
            const showChange = blockW > 8 && blockH > 8
            const showVolume = blockW > 16 && blockH > 14
            // Minimum font sizes for readability
            const tickerFontSize = blockW > 25 ? '14px' : blockW > 15 ? '12px' : '11px'
            const changeFontSize = blockW > 25 ? '12px' : blockW > 15 ? '11px' : '10px'

            return (
              <div
                key={block.name}
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
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
                  className="w-full h-full flex flex-col items-center justify-center overflow-hidden"
                  style={{
                    background: color,
                    borderRadius: 0,
                    opacity: isHovered ? 0.85 : 1,
                    transition: 'opacity 100ms ease-out',
                  }}
                >
                  {showTicker && (
                    <span
                      className="font-bold text-white leading-none"
                      style={{ fontSize: tickerFontSize }}
                    >
                      {block.name}
                    </span>
                  )}
                  {showChange && (
                    <span
                      className="font-mono font-semibold leading-none mt-0.5"
                      style={{
                        fontSize: changeFontSize,
                        color: '#fff',
                      }}
                    >
                      {block.change >= 0 ? '+' : ''}{block.change.toFixed(2)}%
                    </span>
                  )}
                  {showVolume && (
                    <span
                      className="font-mono text-white/50 leading-none mt-0.5"
                      style={{ fontSize: '9px' }}
                    >
                      {formatVolume(block.volume)}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Tooltip — rendered fixed, follows cursor */}
      {hoveredBlock && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: tooltipPos.x + 12,
            top: tooltipPos.y + 12,
            transition: 'opacity 100ms ease-out',
          }}
        >
          {hoveredBlock.type === 'others' ? (
            /* Others tooltip — scrollable list */
            <div
              className="px-3 py-2"
              style={{
                background: BG,
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 0,
                maxHeight: '240px',
                overflowY: 'auto',
                minWidth: '180px',
              }}
            >
              <p className="text-white text-xs font-semibold mb-1.5">{hoveredBlock.name}</p>
              {hoveredBlock.assets?.map(a => (
                <div key={a.name} className="flex items-center justify-between gap-4 py-0.5">
                  <span className="font-mono text-white text-[11px]">{a.name}</span>
                  <span
                    className="font-mono text-[11px]"
                    style={{ color: a.change > 0.5 ? COLOR_POS : a.change < -0.5 ? COLOR_NEG : 'rgba(255,255,255,0.55)' }}
                  >
                    {a.change >= 0 ? '+' : ''}{a.change.toFixed(2)}%
                  </span>
                </div>
              ))}
            </div>
          ) : (
            /* Individual asset tooltip — always shows name, 24h change, and 24h volume */
            <div
              className="px-3 py-2"
              style={{
                background: BG,
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 0,
                minWidth: '180px',
              }}
            >
              <p className="text-white text-xs font-semibold">{hoveredBlock.name}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] text-white/40">24h Change</span>
                <span
                  className="font-mono text-[11px] font-semibold"
                  style={{ color: hoveredBlock.change > 0.5 ? COLOR_POS : hoveredBlock.change < -0.5 ? COLOR_NEG : 'rgba(255,255,255,0.55)' }}
                >
                  {hoveredBlock.change >= 0 ? '+' : ''}{hoveredBlock.change.toFixed(2)}%
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] text-white/40">24h Volume</span>
                <span className="font-mono text-[11px] text-white/70">{formatVolume(hoveredBlock.volume)}</span>
              </div>
              {hoveredBlock.price > 0 && (
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-white/40">Price</span>
                  <span className="font-mono text-[11px] text-white/70">{formatPrice(hoveredBlock.price)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
