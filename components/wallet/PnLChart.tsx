'use client'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { DailyPnl } from '@/lib/analytics/pnl'

interface PnLChartProps {
  data: DailyPnl[]
}

export function PnLChart({ data }: PnLChartProps) {
  if (!data.length) {
    return <p className="text-white/55 text-sm text-center py-8">No PnL data available</p>
  }

  const isPositive = data[data.length - 1]?.cumulative >= 0

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
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
  )
}
