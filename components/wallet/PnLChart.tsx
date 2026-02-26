'use client'
import { useState, useMemo } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { PortfolioEntry } from '@/lib/hyperliquid/types'

type Timeframe = '7D' | '30D' | '90D' | 'All'

// Map UI timeframe to portfolio API timeframe label
const TIMEFRAME_MAP: Record<Timeframe, string> = {
  '7D': 'perpDay',
  '30D': 'perpMonth',
  '90D': 'perpMonth',
  'All': 'allTime',
}

interface PnLChartProps {
  portfolio: PortfolioEntry[]
}

interface ChartPoint {
  date: string
  cumulative: number
}

function extractPnlHistory(portfolio: PortfolioEntry[], timeframeLabel: string): ChartPoint[] {
  const entry = portfolio.find(([key]) => key === timeframeLabel)
  if (!entry) return []

  const history = entry[1]?.pnlHistory
  if (!Array.isArray(history) || history.length === 0) return []

  return history.map(([timestamp, value]) => ({
    date: new Date(timestamp).toISOString().split('T')[0],
    cumulative: Math.round(parseFloat(value) * 100) / 100,
  }))
}

function deduplicateByDate(points: ChartPoint[]): ChartPoint[] {
  const map = new Map<string, number>()
  for (const p of points) {
    map.set(p.date, p.cumulative)
  }
  return Array.from(map.entries())
    .map(([date, cumulative]) => ({ date, cumulative }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

function filterByTimeframe(data: ChartPoint[], tf: Timeframe): ChartPoint[] {
  if (tf === 'All' || !data.length) return data
  const days = tf === '7D' ? 7 : tf === '30D' ? 30 : 90
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = cutoff.toISOString().split('T')[0]
  const filtered = data.filter(d => d.date >= cutoffStr)
  if (filtered.length === 0) return data
  return filtered
}

export function PnLChart({ portfolio }: PnLChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('All')

  const chartData = useMemo(() => {
    const tfLabel = TIMEFRAME_MAP[timeframe]
    const points = extractPnlHistory(portfolio, tfLabel)
    const deduped = deduplicateByDate(points)
    // For 90D, we use perpMonth data but filter to last 90 days
    if (timeframe === '90D') {
      return filterByTimeframe(deduped, '90D')
    }
    return deduped
  }, [portfolio, timeframe])

  if (!portfolio.length || !chartData.length) {
    return <p className="text-white/55 text-sm text-center py-8">No PnL data available</p>
  }

  const isPositive = chartData[chartData.length - 1]?.cumulative >= 0

  return (
    <div>
      <div className="flex items-center gap-1 mb-3">
        {(['7D', '30D', '90D', 'All'] as Timeframe[]).map(tf => (
          <button
            key={tf}
            onClick={() => setTimeframe(tf)}
            className={`text-[10px] font-mono px-2.5 py-1 rounded transition-colors ${
              timeframe === tf
                ? 'bg-[#34EAB9] text-[#0F1A1E] font-semibold'
                : 'bg-[#0F1A1E] text-white/55 hover:text-white/80'
            }`}
          >
            {tf}
          </button>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isPositive ? '#34EAB9' : '#FF3B5C'} stopOpacity={0.3} />
              <stop offset="100%" stopColor={isPositive ? '#34EAB9' : '#FF3B5C'} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(val) => {
              const d = new Date(val)
              return `${d.getMonth() + 1}/${d.getDate()}`
            }}
          />
          <YAxis
            tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(val) => `$${Math.abs(val) >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#0F1A1E',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '12px',
              fontSize: '12px',
            }}
            labelStyle={{ color: 'rgba(255,255,255,0.55)' }}
            formatter={(value: number) => [`$${value.toLocaleString()}`, 'Cumulative PnL']}
          />
          <Area
            type="monotone"
            dataKey="cumulative"
            stroke={isPositive ? '#34EAB9' : '#FF3B5C'}
            strokeWidth={2}
            fill="url(#pnlGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
