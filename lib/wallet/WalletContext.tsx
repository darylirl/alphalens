'use client'
import { createContext, useContext, useState, useEffect, useCallback } from 'react'

interface WalletContextType {
  address: string | null
  connecting: boolean
  connect: () => Promise<void>
  disconnect: () => void
}

const WalletContext = createContext<WalletContextType>({
  address: null,
  connecting: false,
  connect: async () => {},
  disconnect: () => {},
})

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('connected_wallet')
    if (saved) setAddress(saved)
  }, [])

  const connect = useCallback(async () => {
    setConnecting(true)
    try {
      if (typeof window !== 'undefined' && (window as any).ethereum) {
        const accounts = await (window as any).ethereum.request({
          method: 'eth_requestAccounts',
        })
        if (accounts?.[0]) {
          setAddress(accounts[0])
          localStorage.setItem('connected_wallet', accounts[0])
        }
      } else {
        alert('Please install MetaMask or another Web3 wallet')
      }
    } catch (err) {
      console.error('Wallet connection failed:', err)
    } finally {
      setConnecting(false)
    }
  }, [])

  const disconnect = useCallback(() => {
    setAddress(null)
    localStorage.removeItem('connected_wallet')
  }, [])

  return (
    <WalletContext.Provider value={{ address, connecting, connect, disconnect }}>
      {children}
    </WalletContext.Provider>
  )
}

export const useWallet = () => useContext(WalletContext)
