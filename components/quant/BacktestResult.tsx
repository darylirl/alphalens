'use client'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

export interface BacktestSignal {
  date: string
  asset: string
  direction: 'Long' | 'Short'
  entry: number
  exit: number
  pnl: number
}

interface BacktestResultProps {
  strategyName?: string
  data: Array<{ date: string; pnl: number }>
  totalPnl: number
  winRate: number
  tradeCount: number
  sharpe: number
  maxDrawdown?: number
  signals?: BacktestSignal[]
}

export function BacktestResult({ strategyName, data, totalPnl, winRate, tradeCount, sharpe, maxDrawdown, signals }: BacktestResultProps) {
  const isPositive = totalPnl >= 0

  return (
    <div className="card p-4 space-y-4">
      {strategyName && (
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">Backtest Results — {strategyName}</h4>
          <span className="text-[10px] text-white/40 font-mono">Last 90 days</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="bg-[#0F1A1E] rounded p-3">
          <p className="text-white/55 text-xs mb-1">Total Return</p>
          <p className={`font-mono font-semibold text-sm ${isPositive ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
            {isPositive ? '+' : '-'}${Math.abs(totalPnl).toLocaleString()}
          </p>
        </div>
        <div className="bg-[#0F1A1E] rounded p-3">
          <p className="text-white/55 text-xs mb-1">Sharpe Ratio</p>
          <p className={`font-mono font-semibold text-sm ${sharpe >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>{sharpe >= 0 ? '+' : ''}{sharpe.toFixed(2)}</p>
        </div>
        <div className="bg-[#0F1A1E] rounded p-3">
          <p className="text-white/55 text-xs mb-1">Max Drawdown</p>
          <p className="font-mono font-semibold text-sm text-[#FF3B5C]">
            -${(maxDrawdown ?? Math.round(Math.abs(totalPnl) * 0.3)).toLocaleString()}
          </p>
        </div>
        <div className="bg-[#0F1A1E] rounded p-3">
          <p className="text-white/55 text-xs mb-1">Total Signals</p>
          <p className="font-mono font-semibold text-sm">{tradeCount}</p>
        </div>
      </div>

      <div>
        <h4 className="text-xs text-white/55 mb-2">Equity Curve</h4>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="btGradient" x1="0" y1="0" x2="0" y2="1">
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
            <YAxis tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ backgroundColor: '#0F1A1E', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', fontSize: '12px' }}
              labelStyle={{ color: 'rgba(255,255,255,0.55)' }}
              formatter={(value: number) => [`${value >= 0 ? '+' : '-'}$${Math.abs(value).toLocaleString()}`, 'PnL']}
            />
            <Area type="monotone" dataKey="pnl" stroke={isPositive ? '#34EAB9' : '#FF3B5C'} strokeWidth={2} fill="url(#btGradient)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {signals && signals.length > 0 && (
        <div>
          <h4 className="text-xs text-white/55 mb-2">Trade Log ({signals.length} trades)</h4>
          <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[#141E23]">
                <tr className="text-white/40 border-b border-white/[0.06]">
                  <th className="text-left py-2 pr-3 font-medium">Date</th>
                  <th className="text-left py-2 pr-3 font-medium">Asset</th>
                  <th className="text-left py-2 pr-3 font-medium">Dir</th>
                  <th className="text-right py-2 pr-3 font-medium">Entry</th>
                  <th className="text-right py-2 pr-3 font-medium">Exit</th>
                  <th className="text-right py-2 font-medium">PnL</th>
                </tr>
              </thead>
              <tbody>
                {signals.map((s, i) => (
                  <tr key={i} className="border-b border-white/[0.04]">
                    <td className="py-2 pr-3 font-mono text-white/55">{s.date}</td>
                    <td className="py-2 pr-3 font-semibold text-[#F0FAF8]">{s.asset}</td>
                    <td className={`py-2 pr-3 font-semibold ${s.direction === 'Long' ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                      {s.direction}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-white/55">${s.entry.toLocaleString()}</td>
                    <td className="py-2 pr-3 text-right font-mono text-white/55">${s.exit.toLocaleString()}</td>
                    <td className={`py-2 text-right font-mono font-semibold ${s.pnl >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                      {s.pnl >= 0 ? '+' : '-'}${Math.abs(s.pnl).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
