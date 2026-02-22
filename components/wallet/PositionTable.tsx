import type { AssetPosition } from '@/lib/hyperliquid/types'

interface PositionTableProps {
  positions: AssetPosition[]
}

export function PositionTable({ positions }: PositionTableProps) {
  const active = positions.filter(p => parseFloat(p.position.szi) !== 0)

  if (!active.length) {
    return <p className="text-white/55 text-sm text-center py-4">No open positions</p>
  }

  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-white/55 text-xs">
            <th className="text-left py-2 font-medium">Asset</th>
            <th className="text-left py-2 font-medium">Side</th>
            <th className="text-right py-2 font-medium">Size</th>
            <th className="text-right py-2 font-medium">Entry</th>
            <th className="text-right py-2 font-medium">uPnL</th>
            <th className="text-right py-2 font-medium">Lev</th>
          </tr>
        </thead>
        <tbody>
          {active.map((ap, i) => {
            const pos = ap.position
            const size = parseFloat(pos.szi)
            const isLong = size > 0
            const upnl = parseFloat(pos.unrealizedPnl)
            const entry = pos.entryPx ? parseFloat(pos.entryPx) : 0
            const leverage = pos.leverage?.value || 0

            return (
              <tr key={i} className="border-t border-white/[0.08]">
                <td className="py-2.5 font-medium">{pos.coin}</td>
                <td className={`py-2.5 ${isLong ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                  {isLong ? 'Long' : 'Short'}
                </td>
                <td className="py-2.5 text-right font-mono">{Math.abs(size).toFixed(4)}</td>
                <td className="py-2.5 text-right font-mono">${entry.toLocaleString()}</td>
                <td className={`py-2.5 text-right font-mono ${upnl >= 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                  {upnl >= 0 ? '+' : ''}${upnl.toFixed(2)}
                </td>
                <td className="py-2.5 text-right font-mono">{leverage}x</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
