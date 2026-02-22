type MessageHandler = (data: unknown) => void

interface Subscription {
  type: string
  user?: string
  coin?: string
}

export class HyperliquidWebSocket {
  private ws: WebSocket | null = null
  private url = 'wss://api.hyperliquid.xyz/ws'
  private handlers: Map<string, MessageHandler[]> = new Map()
  private subscriptions: Subscription[] = []
  private reconnectAttempts = 0
  private maxReconnects = 5
  private reconnectDelay = 1000

  connect(): void {
    this.ws = new WebSocket(this.url)

    this.ws.onopen = () => {
      this.reconnectAttempts = 0
      this.subscriptions.forEach((sub) => this.send('subscribe', sub))
    }

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        const channel = data?.channel
        if (channel && this.handlers.has(channel)) {
          this.handlers.get(channel)!.forEach((handler) => handler(data.data))
        }
      } catch {
        // ignore parse errors
      }
    }

    this.ws.onclose = () => {
      if (this.reconnectAttempts < this.maxReconnects) {
        setTimeout(() => {
          this.reconnectAttempts++
          this.connect()
        }, this.reconnectDelay * Math.pow(2, this.reconnectAttempts))
      }
    }

    this.ws.onerror = () => {
      this.ws?.close()
    }
  }

  private send(method: string, subscription: Subscription): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ method, subscription }))
    }
  }

  subscribe(subscription: Subscription, handler: MessageHandler): () => void {
    const key = JSON.stringify(subscription)
    if (!this.handlers.has(key)) {
      this.handlers.set(key, [])
    }
    this.handlers.get(key)!.push(handler)
    this.subscriptions.push(subscription)

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send('subscribe', subscription)
    }

    return () => {
      const handlers = this.handlers.get(key)
      if (handlers) {
        const idx = handlers.indexOf(handler)
        if (idx >= 0) handlers.splice(idx, 1)
      }
      this.send('unsubscribe', subscription)
    }
  }

  subscribeUserEvents(address: string, handler: MessageHandler): () => void {
    return this.subscribe({ type: 'userEvents', user: address }, handler)
  }

  subscribeTrades(coin: string, handler: MessageHandler): () => void {
    return this.subscribe({ type: 'trades', coin }, handler)
  }

  subscribeAssetCtx(coin: string, handler: MessageHandler): () => void {
    return this.subscribe({ type: 'activeAssetCtx', coin }, handler)
  }

  disconnect(): void {
    this.ws?.close()
    this.ws = null
    this.handlers.clear()
    this.subscriptions = []
  }
}
