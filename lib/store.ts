import { create } from 'zustand'
import type { WalletAnalytics } from '@/lib/hyperliquid/types'

interface WatchlistState {
  watchlists: Array<{
    id: string
    name: string
    addresses: string[]
  }>
  addWatchlist: (name: string) => void
  removeWatchlist: (id: string) => void
  addToWatchlist: (listId: string, address: string) => void
  removeFromWatchlist: (listId: string, address: string) => void
}

export const useWatchlistStore = create<WatchlistState>((set) => ({
  watchlists: [],
  addWatchlist: (name) =>
    set((state) => ({
      watchlists: [
        ...state.watchlists,
        { id: crypto.randomUUID(), name, addresses: [] },
      ],
    })),
  removeWatchlist: (id) =>
    set((state) => ({
      watchlists: state.watchlists.filter((w) => w.id !== id),
    })),
  addToWatchlist: (listId, address) =>
    set((state) => ({
      watchlists: state.watchlists.map((w) =>
        w.id === listId && !w.addresses.includes(address)
          ? { ...w, addresses: [...w.addresses, address] }
          : w
      ),
    })),
  removeFromWatchlist: (listId, address) =>
    set((state) => ({
      watchlists: state.watchlists.map((w) =>
        w.id === listId
          ? { ...w, addresses: w.addresses.filter((a) => a !== address) }
          : w
      ),
    })),
}))

interface AlertState {
  alerts: Array<{
    id: string
    walletAddress: string
    eventType: string
    asset: string
    side: string
    size: number
    price: number
    leverage: number
    triggeredAt: string
  }>
  addAlert: (alert: Omit<AlertState['alerts'][0], 'id'>) => void
  clearAlerts: () => void
}

export const useAlertStore = create<AlertState>((set) => ({
  alerts: [],
  addAlert: (alert) =>
    set((state) => ({
      alerts: [{ ...alert, id: crypto.randomUUID() }, ...state.alerts].slice(0, 100),
    })),
  clearAlerts: () => set({ alerts: [] }),
}))

interface HunterFilters {
  archetype: string
  sort: string
  setArchetype: (archetype: string) => void
  setSort: (sort: string) => void
}

export const useHunterFilters = create<HunterFilters>((set) => ({
  archetype: 'all',
  sort: 'sharpe_30d',
  setArchetype: (archetype) => set({ archetype }),
  setSort: (sort) => set({ sort }),
}))
