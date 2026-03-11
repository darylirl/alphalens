import { getSupabase } from '@/lib/db/supabase'

const NOTIONAL_THRESHOLD = 50_000

interface TradeEvent {
  coin: string
  side: string  // 'B' or 'A'
  px: string
  sz: string
  time: number
  wallets: string[]
}

interface GeneratedSignal {
  signal_id: string
  wallet_address: string
  wallet_label: string | null
  wallet_tags: string[]
  coin: string
  side: 'long' | 'short'
  entry_price: number
  notional_usd: number
  confidence: 'high' | 'medium' | 'low'
  source: string
}

/**
 * Determine confidence level based on wallet's historical win rate.
 * Queries the fills table for past fills from this wallet.
 */
async function getWalletConfidence(address: string): Promise<'high' | 'medium' | 'low'> {
  try {
    const supabase = getSupabase()

    // Check wallet analytics for win rate
    const { data: wallet } = await supabase
      .from('wallets')
      .select('win_rate, label')
      .eq('address', address.toLowerCase())
      .single()

    if (wallet?.win_rate) {
      const winRate = Number(wallet.win_rate)
      if (winRate >= 0.6) return 'high'
      if (winRate >= 0.45) return 'medium'
      return 'low'
    }

    return 'medium' // default when no history available
  } catch {
    return 'medium'
  }
}

/**
 * Get wallet label and tags from the wallets table.
 */
async function getWalletInfo(address: string): Promise<{ label: string | null; tags: string[] }> {
  try {
    const supabase = getSupabase()
    const { data } = await supabase
      .from('wallets')
      .select('label, tags')
      .eq('address', address.toLowerCase())
      .single()
    return { label: data?.label || null, tags: data?.tags || [] }
  } catch {
    return { label: null, tags: [] }
  }
}

/**
 * Check if a trade event qualifies as a signal and generate + store it.
 * Returns the generated signals, or empty array if none qualified.
 */
export async function maybeGenerateSignal(trade: TradeEvent): Promise<GeneratedSignal[]> {
  const price = parseFloat(trade.px)
  const size = parseFloat(trade.sz)
  const notional = price * size

  // Only generate signals for trades above the notional threshold
  if (notional < NOTIONAL_THRESHOLD) return []

  const signals: GeneratedSignal[] = []
  const supabase = getSupabase()

  for (const wallet of trade.wallets) {
    const [confidence, walletInfo] = await Promise.all([
      getWalletConfidence(wallet),
      getWalletInfo(wallet),
    ])

    const signal: GeneratedSignal = {
      signal_id: crypto.randomUUID(),
      wallet_address: wallet.toLowerCase(),
      wallet_label: walletInfo.label,
      wallet_tags: walletInfo.tags,
      coin: trade.coin,
      side: trade.side === 'B' ? 'long' : 'short',
      entry_price: price,
      notional_usd: Math.round(notional * 100) / 100,
      confidence,
      source: 'hyperliquid_smart_money',
    }

    // Persist to Supabase
    try {
      await supabase.from('signals').insert({
        signal_id: signal.signal_id,
        wallet_address: signal.wallet_address,
        wallet_label: signal.wallet_label,
        wallet_tags: signal.wallet_tags,
        coin: signal.coin,
        side: signal.side,
        entry_price: signal.entry_price,
        notional_usd: signal.notional_usd,
        confidence: signal.confidence,
        source: signal.source,
        status: 'active',
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
    } catch {
      // Log but don't fail the stream if insert fails
      if (process.env.NODE_ENV === 'development') {
        console.error(`[Signals] Failed to persist signal for ${wallet}`)
      }
    }

    signals.push(signal)
  }

  return signals
}
