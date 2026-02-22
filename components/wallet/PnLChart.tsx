'use client'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { DailyPnl } from '@/lib/analytics/pnl'

interface PnLChartProps {
  data: DailyPnl[]
}

export function PnLChart({ data }: PnLChartProps) {
  if (!data.length) {
    return <p className="text-[#888888] text-sm text-center py-8">No PnL data available</p>
  }

  const isPositive = data[data.length - 1]?.cumulative >= 0

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={isPositive ? '#00ff88' : '#ff3b3b'} stopOpacity={0.3} />
            <stop offset="100%" stopColor={isPositive ? '#00ff88' : '#ff3b3b'} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date"
          tick={{ fill: '#888888', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(val) => {
            const d = new Date(val)
            return `${d.getMonth() + 1}/${d.getDate()}`
          }}
        />
        <YAxis
          tick={{ fill: '#888888', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(val) => `$${val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}`}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#161616',
            border: '1px solid #222222',
            borderRadius: '12px',
            fontSize: '12px',
          }}
          labelStyle={{ color: '#888888' }}
          formatter={(value: number) => [`$${value.toLocaleString()}`, 'Cumulative PnL']}
        />
        <Area
          type="monotone"
          dataKey="cumulative"
          stroke={isPositive ? '#00ff88' : '#ff3b3b'}
          strokeWidth={2}
          fill="url(#pnlGradient)"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
