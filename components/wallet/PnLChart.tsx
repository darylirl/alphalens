'use client'
import { useState, useMemo } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { DailyPnl } from '@/lib/analytics/pnl'

type Timeframe = '7D' | '30D' | '90D' | 'All'

interface PnLChartProps {
  data: DailyPnl[]
}

function filterByTimeframe(data: DailyPnl[], tf: Timeframe): DailyPnl[] {
  if (tf === 'All' || !data.length) return data
  const days = tf === '7D' ? 7 : tf === '30D' ? 30 : 90
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = cutoff.toISOString().split('T')[0]
  const filtered = data.filter(d => d.date >= cutoffStr)
  if (filtered.length === 0) return data
  return filtered
}

function fillDateGaps(data: DailyPnl[]): DailyPnl[] {
  if (data.length < 2) return data

  const result: DailyPnl[] = []
  const startDate = new Date(data[0].date)
  const endDate = new Date(data[data.length - 1].date)
  const dateMap = new Map(data.map(d => [d.date, d]))

  let lastCumulative = 0
  const current = new Date(startDate)
  while (current <= endDate) {
    const dateStr = current.toISOString().split('T')[0]
    const entry = dateMap.get(dateStr)
    if (entry) {
      lastCumulative = entry.cumulative
      result.push(entry)
    } else {
      result.push({ date: dateStr, pnl: 0, cumulative: lastCumulative })
    }
    current.setDate(current.getDate() + 1)
  }
  return result
}

export function PnLChart({ data }: PnLChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('30D')

  const chartData = useMemo(() => {
    const filtered = filterByTimeframe(data, timeframe)
    return fillDateGaps(filtered)
  }, [data, timeframe])

  if (!data.length) {
    return <p className="text-white/55 text-sm text-center py-8">No PnL data available</p>
  }

  const isPositive = chartData[chartData.length - 1]?.cumulative >= 0

  return (
    <div>
      {/* Timeframe toggle */}
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
            tickFormatter={(val) => `$${val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}`}
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
