import { NextRequest } from 'next/server'

export const runtime = 'edge'

const ETH_RE = /^0x[a-fA-F0-9]{40}$/
const MAX_RECONNECTS = 10
const BASE_DELAY = 1000
const MAX_DELAY = 30000

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('address')
  if (!raw || !ETH_RE.test(raw)) return new Response('Valid Ethereum address required', { status: 400 })
  const address = raw.toLowerCase()

  const encoder = new TextEncoder()
  let aborted = false

  const stream = new ReadableStream({
    async start(controller) {
      let reconnectAttempts = 0

      function connectWs() {
        if (aborted) return

        const ws = new WebSocket('wss://api.hyperliquid.xyz/ws')

        ws.onopen = () => {
          reconnectAttempts = 0
          ws.send(JSON.stringify({
            method: 'subscribe',
            subscription: { type: 'userEvents', user: address },
          }))
          // Send connected event to client
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected', address })}\n\n`))
          } catch { /* controller closed */ }
        }

        ws.onmessage = (event) => {
          try {
            controller.enqueue(encoder.encode(`data: ${event.data}\n\n`))
          } catch { /* controller closed */ }
        }

        ws.onerror = () => ws.close()

        ws.onclose = () => {
          if (aborted) return

          if (reconnectAttempts < MAX_RECONNECTS) {
            const delay = Math.min(BASE_DELAY * Math.pow(2, reconnectAttempts), MAX_DELAY)
            reconnectAttempts++
            // Notify client of reconnection
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'reconnecting', attempt: reconnectAttempts, delay })}\n\n`))
            } catch { /* controller closed */ }
            setTimeout(connectWs, delay)
          } else {
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'disconnected', reason: 'max_retries' })}\n\n`))
              controller.close()
            } catch { /* already closed */ }
          }
        }

        req.signal.addEventListener('abort', () => {
          aborted = true
          ws.close()
          try { controller.close() } catch { /* already closed */ }
        })
      }

      connectWs()
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
