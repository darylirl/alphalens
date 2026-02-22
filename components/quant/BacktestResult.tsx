'use client'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

interface BacktestResultProps {
  data: Array<{ date: string; pnl: number }>
  totalPnl: number
  winRate: number
  tradeCount: number
  sharpe: number
}

export function BacktestResult({ data, totalPnl, winRate, tradeCount, sharpe }: BacktestResultProps) {
  const isPositive = totalPnl >= 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="bg-[#111111] rounded-xl p-3">
          <p className="text-[#888888] text-xs mb-1">Paper PnL</p>
          <p className={`font-semibold text-sm ${isPositive ? 'text-[#00ff88]' : 'text-[#ff3b3b]'}`}>
            {isPositive ? '+' : ''}${totalPnl.toLocaleString()}
          </p>
        </div>
        <div className="bg-[#111111] rounded-xl p-3">
          <p className="text-[#888888] text-xs mb-1">Win Rate</p>
          <p className="font-semibold text-sm">{(winRate * 100).toFixed(0)}%</p>
        </div>
        <div className="bg-[#111111] rounded-xl p-3">
          <p className="text-[#888888] text-xs mb-1">Trades</p>
          <p className="font-semibold text-sm">{tradeCount}</p>
        </div>
        <div className="bg-[#111111] rounded-xl p-3">
          <p className="text-[#888888] text-xs mb-1">Sharpe</p>
          <p className="font-semibold text-sm">{sharpe.toFixed(2)}</p>
        </div>
      </div>

      <div className="card p-4">
        <h4 className="text-sm font-semibold mb-3">Equity Curve</h4>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="btGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={isPositive ? '#00ff88' : '#ff3b3b'} stopOpacity={0.3} />
                <stop offset="100%" stopColor={isPositive ? '#00ff88' : '#ff3b3b'} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" tick={{ fill: '#888888', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#888888', fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ backgroundColor: '#161616', border: '1px solid #222222', borderRadius: '12px', fontSize: '12px' }}
              labelStyle={{ color: '#888888' }}
            />
            <Area type="monotone" dataKey="pnl" stroke={isPositive ? '#00ff88' : '#ff3b3b'} strokeWidth={2} fill="url(#btGradient)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
