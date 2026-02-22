import type { Fill } from '@/lib/hyperliquid/types'

interface TokenMetric {
  token: string
  roi: number
  netPnl: number
  volume: number
  trades: number
  winRate: number
  wins: number
  losses: number
  avgWin: number
  avgLoss: number
}

function computeTokenMetrics(fills: Fill[]): TokenMetric[] {
  const byToken: Record<string, { pnl: number; volume: number; trades: number; wins: number; losses: number; winPnl: number; lossPnl: number }> = {}

  for (const fill of fills) {
    const token = fill.coin
    if (!byToken[token]) {
      byToken[token] = { pnl: 0, volume: 0, trades: 0, wins: 0, losses: 0, winPnl: 0, lossPnl: 0 }
    }
    const b = byToken[token]
    const closedPnl = parseFloat(fill.closedPnl || '0')
    const tradeVolume = Math.abs(parseFloat(fill.px) * parseFloat(fill.sz))

    b.pnl += closedPnl
    b.volume += tradeVolume
    b.trades++

    if (closedPnl > 0) {
      b.wins++
      b.winPnl += closedPnl
    } else if (closedPnl < 0) {
      b.losses++
      b.lossPnl += Math.abs(closedPnl)
    }
  }

  return Object.entries(byToken)
    .map(([token, b]) => ({
      token,
      roi: b.volume > 0 ? (b.pnl / b.volume) * 100 : 0,
      netPnl: b.pnl,
      volume: b.volume,
      trades: b.trades,
      winRate: b.trades > 0 ? b.wins / b.trades : 0,
      wins: b.wins,
      losses: b.losses,
      avgWin: b.wins > 0 ? b.winPnl / b.wins : 0,
      avgLoss: b.losses > 0 ? b.lossPnl / b.losses : 0,
    }))
    .sort((a, b) => b.volume - a.volume)
}

export function TokenMetrics({ fills }: { fills: Fill[] }) {
  const metrics = computeTokenMetrics(fills)

  if (!metrics.length) {
    return <p className="text-[#8AADA9] text-sm text-center py-4">No trade history</p>
  }

  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[#8AADA9] text-xs">
            <th className="text-left py-2 font-medium">Token</th>
            <th className="text-right py-2 font-medium">ROI %</th>
            <th className="text-right py-2 font-medium">Net PnL</th>
            <th className="text-right py-2 font-medium">Volume</th>
            <th className="text-right py-2 font-medium">Trades</th>
            <th className="text-right py-2 font-medium">Win Rate</th>
            <th className="text-right py-2 font-medium">Wins</th>
            <th className="text-right py-2 font-medium">Losses</th>
            <th className="text-right py-2 font-medium">Avg Win</th>
            <th className="text-right py-2 font-medium">Avg Loss</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map(m => (
            <tr key={m.token} className="border-t border-[#0D2E2A]">
              <td className="py-2.5 font-medium">{m.token}</td>
              <td className={`py-2.5 text-right font-mono ${m.roi >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                {m.roi.toFixed(2)}%
              </td>
              <td className={`py-2.5 text-right font-mono ${m.netPnl >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                ${m.netPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </td>
              <td className="py-2.5 text-right font-mono">
                ${m.volume.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </td>
              <td className="py-2.5 text-right">{m.trades.toLocaleString()}</td>
              <td className="py-2.5 text-right">
                {(m.winRate * 100).toFixed(1)}%
              </td>
              <td className="py-2.5 text-right text-[#34EAB9]">{m.wins}</td>
              <td className="py-2.5 text-right text-[#FF3B5C]">{m.losses}</td>
              <td className="py-2.5 text-right font-mono text-[#34EAB9]">
                ${m.avgWin.toFixed(2)}
              </td>
              <td className="py-2.5 text-right font-mono text-[#FF3B5C]">
                ${m.avgLoss.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
