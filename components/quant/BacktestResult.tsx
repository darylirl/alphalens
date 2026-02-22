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
        <div className="bg-[#0F1A1E] rounded p-3">
          <p className="text-white/55 text-xs mb-1">Paper PnL</p>
          <p className={`font-mono font-semibold text-sm ${isPositive ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
            {isPositive ? '+' : ''}${totalPnl.toLocaleString()}
          </p>
        </div>
        <div className="bg-[#0F1A1E] rounded p-3">
          <p className="text-white/55 text-xs mb-1">Win Rate</p>
          <p className="font-mono font-semibold text-sm">{(winRate * 100).toFixed(0)}%</p>
        </div>
        <div className="bg-[#0F1A1E] rounded p-3">
          <p className="text-white/55 text-xs mb-1">Trades</p>
          <p className="font-mono font-semibold text-sm">{tradeCount}</p>
        </div>
        <div className="bg-[#0F1A1E] rounded p-3">
          <p className="text-white/55 text-xs mb-1">Sharpe</p>
          <p className="font-mono font-semibold text-sm">{sharpe.toFixed(2)}</p>
        </div>
      </div>

      <div className="card p-4">
        <h4 className="text-sm font-semibold mb-3">Equity Curve</h4>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="btGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={isPositive ? '#34EAB9' : '#FF3B5C'} stopOpacity={0.3} />
                <stop offset="100%" stopColor={isPositive ? '#34EAB9' : '#FF3B5C'} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ backgroundColor: '#0F1A1E', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', fontSize: '12px' }}
              labelStyle={{ color: 'rgba(255,255,255,0.55)' }}
            />
            <Area type="monotone" dataKey="pnl" stroke={isPositive ? '#34EAB9' : '#FF3B5C'} strokeWidth={2} fill="url(#btGradient)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
