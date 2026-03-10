'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import type { Fill, AssetPosition } from '@/lib/hyperliquid/types'

export type StreamStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

interface WalletStreamEvent {
  type?: string
  fills?: Array<Record<string, unknown>>
  positions?: AssetPosition[]
}

const MAX_FILLS = 100
const MAX_RETRY_DELAY = 30_000
const BASE_RETRY_DELAY = 1_000

export function useWalletStream(address: string | undefined) {
  const [status, setStatus] = useState<StreamStatus>('disconnected')
  const [liveFills, setLiveFills] = useState<Fill[]>([])
  const [livePositions, setLivePositions] = useState<AssetPosition[] | null>(null)
  const esRef = useRef<EventSource | null>(null)
  const retryRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const connect = useCallback(() => {
    if (!address) return

    setStatus('connecting')

    const es = new EventSource(`/api/stream?address=${address}`)
    esRef.current = es

    es.onopen = () => {
      retryRef.current = 0
      setStatus('connected')
      if (process.env.NODE_ENV === 'development') {
        console.log(`[WalletStream] Connected for ${address}`)
      }
    }

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as WalletStreamEvent

        // Handle fill events — prepend to existing list, cap at MAX_FILLS
        if (data.fills && Array.isArray(data.fills)) {
          const newFills: Fill[] = data.fills.map((f) => ({
            coin: String(f.coin || ''),
            px: String(f.px || '0'),
            sz: String(f.sz || '0'),
            side: (f.side === 'A' ? 'A' : 'B') as 'B' | 'A',
            time: Number(f.time) || Date.now(),
            startPosition: String(f.startPosition || '0'),
            dir: String(f.dir || ''),
            closedPnl: String(f.closedPnl || '0'),
            hash: String(f.hash || ''),
            oid: Number(f.oid) || 0,
            crossed: Boolean(f.crossed),
            fee: String(f.fee || '0'),
            tid: Number(f.tid) || 0,
          }))

          setLiveFills((prev) => [...newFills, ...prev].slice(0, MAX_FILLS))

          if (process.env.NODE_ENV === 'development') {
            console.log(`[WalletStream] ${newFills.length} new fill(s)`, newFills.map(f => `${f.coin} ${f.side}`))
          }
        }

        // Handle position updates — replace matching positions by coin
        if (data.positions && Array.isArray(data.positions)) {
          setLivePositions((prev) => {
            const updated = prev ? [...prev] : []
            for (const incoming of data.positions!) {
              const idx = updated.findIndex(p => p.position.coin === incoming.position.coin)
              if (idx >= 0) {
                updated[idx] = incoming
              } else {
                updated.push(incoming)
              }
            }
            return updated
          })
        }
      } catch {
        // Ignore parse errors from non-JSON SSE messages
      }
    }

    es.onerror = () => {
      es.close()
      esRef.current = null
      setStatus('disconnected')

      // Exponential backoff reconnect
      const delay = Math.min(BASE_RETRY_DELAY * Math.pow(2, retryRef.current), MAX_RETRY_DELAY)
      retryRef.current++

      if (process.env.NODE_ENV === 'development') {
        console.log(`[WalletStream] Disconnected. Reconnecting in ${delay}ms (attempt ${retryRef.current})`)
      }

      retryTimerRef.current = setTimeout(connect, delay)
    }
  }, [address])

  useEffect(() => {
    connect()

    return () => {
      esRef.current?.close()
      esRef.current = null
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
      setStatus('disconnected')
      setLiveFills([])
      setLivePositions(null)
      retryRef.current = 0
    }
  }, [connect])

  return { status, liveFills, livePositions }
}
