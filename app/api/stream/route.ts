import { NextRequest } from 'next/server'

export const runtime = 'edge'

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address')
  if (!address) return new Response('Missing address', { status: 400 })

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
