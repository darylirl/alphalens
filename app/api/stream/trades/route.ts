import { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/db/supabase'
import { maybeGenerateSignal } from '@/lib/signals/generate'

export const runtime = 'edge'

// Top markets to monitor for smart money activity
const COINS = ['BTC', 'ETH', 'SOL', 'HYPE', 'SUI']

export async function GET(req: NextRequest) {
  // Load tracked wallet addresses from Supabase
  let trackedAddresses: Set<string> = new Set()
  try {
    const supabase = getSupabase()
    const { data } = await supabase.from('wallets').select('address').limit(2000)
    if (data) {
      trackedAddresses = new Set(data.map((r: { address: string }) => r.address.toLowerCase()))
    }
  } catch {
    // If Supabase is unavailable, proceed without tracked wallets filter
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const sockets: WebSocket[] = []

      for (const coin of COINS) {
        try {
          const ws = new WebSocket('wss://api.hyperliquid.xyz/ws')

          ws.onopen = () => {
            ws.send(JSON.stringify({
              method: 'subscribe',
              subscription: { type: 'trades', coin },
            }))
          }

          ws.onmessage = (event) => {
            try {
              const msg = JSON.parse(event.data)
              if (msg.channel !== 'trades' || !Array.isArray(msg.data)) return

              for (const trade of msg.data) {
                const users: string[] = trade.users || []
                const matchedWallets = users.filter((u: string) =>
                  trackedAddresses.has(u.toLowerCase())
                )

                if (matchedWallets.length > 0) {
                  const payload = {
                    type: 'smart_money_trade',
                    coin: trade.coin,
                    side: trade.side,
                    px: trade.px,
                    sz: trade.sz,
                    time: trade.time,
                    wallets: matchedWallets,
                  }
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))

                  // Generate signal if notional exceeds $50k threshold
                  maybeGenerateSignal({
                    coin: trade.coin,
                    side: trade.side,
                    px: trade.px,
                    sz: trade.sz,
                    time: trade.time,
                    wallets: matchedWallets,
                  }).catch(() => {
                    // Signal generation failures should not break the stream
                  })
                }
              }
            } catch {
              // Ignore parse errors
            }
          }

          ws.onerror = () => ws.close()
          ws.onclose = () => {
            // Remove from array on close
            const idx = sockets.indexOf(ws)
            if (idx >= 0) sockets.splice(idx, 1)
          }

          sockets.push(ws)
        } catch {
          // Skip coin if WebSocket creation fails
        }
      }

      // Send initial connection message
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: 'connected', coins: COINS, trackedWallets: trackedAddresses.size })}\n\n`)
      )

      // Clean up on client disconnect
      req.signal.addEventListener('abort', () => {
        for (const ws of sockets) ws.close()
        try { controller.close() } catch { /* already closed */ }
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
