import { NextRequest } from 'next/server'

export const runtime = 'edge'

const ETH_RE = /^0x[a-fA-F0-9]{40}$/

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('address')
  if (!raw || !ETH_RE.test(raw)) return new Response('Valid Ethereum address required', { status: 400 })
  const address = raw.toLowerCase()

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const ws = new WebSocket('wss://api.hyperliquid.xyz/ws')

      ws.onopen = () => {
        ws.send(JSON.stringify({
          method: 'subscribe',
          subscription: { type: 'userEvents', user: address }
        }))
      }

      ws.onmessage = (event) => {
        const data = `data: ${event.data}\n\n`
        controller.enqueue(encoder.encode(data))
      }

      ws.onerror = () => controller.close()
      ws.onclose = () => controller.close()

      req.signal.addEventListener('abort', () => {
        ws.close()
        controller.close()
      })
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    }
  })
}
