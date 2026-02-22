import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const body = await req.json()
  const { rule } = body

  // Simplified backtest engine - in production would run against historical fills
  const days = 30
  let cumPnl = 0
  const data = Array.from({ length: days }, (_, i) => {
    const change = (Math.random() - 0.4) * 500
    cumPnl += change
    return {
      date: new Date(Date.now() - (days - i) * 86400000).toISOString().split('T')[0],
      pnl: Math.round(cumPnl)
    }
  })

  return NextResponse.json({
    data,
    totalPnl: Math.round(cumPnl),
    winRate: 0.55 + Math.random() * 0.15,
    tradeCount: Math.floor(20 + Math.random() * 60),
    sharpe: 0.5 + Math.random() * 2,
    rule
  })
}
