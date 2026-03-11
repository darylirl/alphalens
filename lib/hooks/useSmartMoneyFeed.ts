'use client'
import { useEffect, useRef, useState, useCallback } from 'react'

export type FeedStatus = 'connecting' | 'connected' | 'disconnected'

export interface SmartMoneyTrade {
  id: string
  coin: string
  side: 'B' | 'A'
  px: string
  sz: string
  time: number
  wallets: string[]
}

const MAX_TRADES = 50
const FLUSH_INTERVAL = 500
const MAX_RETRY_DELAY = 30_000
const BASE_RETRY_DELAY = 2_000

export function useSmartMoneyFeed() {
  const [status, setStatus] = useState<FeedStatus>('disconnected')
  const [trades, setTrades] = useState<SmartMoneyTrade[]>([])
  const [trackedCount, setTrackedCount] = useState(0)
  const esRef = useRef<EventSource | null>(null)
  const retryRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bufferRef = useRef<SmartMoneyTrade[]>([])

  // Flush buffer into state on a fixed 500ms interval
  useEffect(() => {
    const interval = setInterval(() => {
      if (bufferRef.current.length === 0) return
      const batch = bufferRef.current
      bufferRef.current = []
      setTrades(prev => [...batch, ...prev].slice(0, MAX_TRADES))
    }, FLUSH_INTERVAL)
    return () => clearInterval(interval)
  }, [])

  const connect = useCallback(() => {
    setStatus('connecting')

    const es = new EventSource('/api/stream/trades')
    esRef.current = es

    es.onopen = () => {
      retryRef.current = 0
    }

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)

        if (data.type === 'connected') {
          setStatus('connected')
          setTrackedCount(data.trackedWallets || 0)
          if (process.env.NODE_ENV === 'development') {
            console.log(`[SmartMoneyFeed] Connected. Monitoring ${data.coins?.join(', ')}. Tracking ${data.trackedWallets} wallets.`)
          }
          return
        }

        // Handle batched array payloads from server
        if (data.type === 'smart_money_batch' && Array.isArray(data.trades)) {
          for (const t of data.trades) {
            bufferRef.current.push({
              id: `${t.coin}-${t.time}-${t.px}`,
              coin: t.coin,
              side: t.side,
              px: t.px,
              sz: t.sz,
              time: t.time,
              wallets: t.wallets,
            })
          }
          return
        }

        // Handle single trade events (backward compat)
        if (data.type === 'smart_money_trade') {
          bufferRef.current.push({
            id: `${data.coin}-${data.time}-${data.px}`,
            coin: data.coin,
            side: data.side,
            px: data.px,
            sz: data.sz,
            time: data.time,
            wallets: data.wallets,
          })

          if (process.env.NODE_ENV === 'development') {
            console.log(`[SmartMoneyFeed] Smart money ${data.side === 'B' ? 'BUY' : 'SELL'} ${data.sz} ${data.coin} @ ${data.px}`)
          }
        }
      } catch {
        // Ignore parse errors
      }
    }

    es.onerror = () => {
      es.close()
      esRef.current = null
      setStatus('disconnected')

      const delay = Math.min(BASE_RETRY_DELAY * Math.pow(2, retryRef.current), MAX_RETRY_DELAY)
      retryRef.current++

      if (process.env.NODE_ENV === 'development') {
        console.log(`[SmartMoneyFeed] Disconnected. Reconnecting in ${delay}ms`)
      }

      retryTimerRef.current = setTimeout(connect, delay)
    }
  }, [])

  useEffect(() => {
    connect()

    return () => {
      esRef.current?.close()
      esRef.current = null
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
      setStatus('disconnected')
      retryRef.current = 0
      bufferRef.current = []
    }
  }, [connect])

  return { status, trades, trackedCount }
}
